export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';
import { publish } from '../../../../lib/redis';
import { getRedis } from '../../../../lib/redis';
import fs from 'fs';
import path from 'path';
import { loadEnv } from '../../../../app/lib/env';
import { z } from 'zod';
async function getGuildId(): Promise<string | undefined> {
  // Prefer DB-backed guildId, fallback to env for legacy compatibility
  try {
    const pool = getPool();
    const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['discord']);
    const discord = res.rows[0]?.value || {};
    if (discord && typeof discord.guildId === 'string' && discord.guildId.length > 0) {
      return discord.guildId;
    }
  } catch (_) {}
  try {
    const env = loadEnv();
    if (env && typeof env.DISCORD_GUILD_ID === 'string' && env.DISCORD_GUILD_ID.length > 0) return env.DISCORD_GUILD_ID;
  } catch (_) {}
  return process.env.DISCORD_GUILD_ID;
}

export async function GET() {
  try {
    const pool = getPool();
    const guildId = await getGuildId();
    // Cache key
    const cacheKey = guildId ? `monitored:${guildId}` : 'monitored:all';
    try {
      const c = await getRedis();
      if (c) {
        const hit = await c.get(cacheKey);
        if (hit) return NextResponse.json(JSON.parse(hit));
      }
    } catch (_) {}
    const res = guildId
      ? await pool.query(`SELECT guild_id, channel_id, channel_name, is_active FROM discord_links_channels WHERE guild_id = $1 ORDER BY updated_at DESC, created_at DESC`, [guildId])
      : await pool.query(`SELECT guild_id, channel_id, channel_name, is_active FROM discord_links_channels ORDER BY updated_at DESC, created_at DESC`);
    const payload = { channels: res.rows };
    try {
      const c = await getRedis();
      if (c) await c.set(cacheKey, JSON.stringify(payload), { EX: 60 });
    } catch (_) {}
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const channelSchema = z.object({
      channel_id: z.string().min(1),
      channel_name: z.string().min(1).optional(),
      is_active: z.boolean().optional()
    }).strict();
    const schema = z.object({ channels: z.array(channelSchema).max(500) }).strict();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 422 });
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of parsed.data.channels) {
        if (!row || !row.channel_id) continue;
        const guildId = await getGuildId();
        if (!guildId) continue;
        await client.query(`
          INSERT INTO discord_links_channels (guild_id, channel_id, channel_name, is_active)
          VALUES ($1, $2, $3, COALESCE($4, TRUE))
          ON CONFLICT (guild_id, channel_id)
          DO UPDATE SET channel_name = EXCLUDED.channel_name, is_active = EXCLUDED.is_active, updated_at = CURRENT_TIMESTAMP
        `, [guildId, row.channel_id, row.channel_name || null, row.is_active !== false]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Notify bot admin channel of updated channels
    try {
      const base = process.env.WHATSAPP_BOT_HEALTH_URL || 'http://localhost:3000/whatsapp/chats';
      const url = base.replace('/whatsapp/chats', '/admin/notify');
      const token = process.env.ADMIN_NOTIFY_TOKEN || process.env.NEXT_PUBLIC_ADMIN_NOTIFY_TOKEN;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
        body: JSON.stringify({ type: 'discord_channels_updated', payload: { items: parsed.data.channels } })
      });
      // Publish cache invalidation directly to Redis (best-effort)
      try {
        const guildId = await getGuildId();
        await publish('monitored.invalidate', { guildId });
        // Also evict UI-side cache for this guild
        const c = await getRedis();
        if (c && guildId) await c.del(`monitored:${guildId}`);
      } catch (_) {}
    } catch (_) {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


