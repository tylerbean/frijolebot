export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';
import { publish } from '../../../../lib/redis';
import { getRedis } from '../../../../lib/redis';
import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(process.cwd(), '..', '..', '.env');
function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
function getGuildId(): string | undefined {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const env = parseEnv(content);
    return env.DISCORD_GUILD_ID;
  } catch (_) {
    return process.env.DISCORD_GUILD_ID;
  }
}

export async function GET() {
  try {
    const pool = getPool();
    const guildId = getGuildId();
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
    if (!Array.isArray(body.channels)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of body.channels) {
        if (!row || !row.channel_id) continue;
        const guildId = getGuildId();
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
        body: JSON.stringify({ type: 'discord_channels_updated', payload: { items: body.channels } })
      });
      // Publish cache invalidation directly to Redis (best-effort)
      try {
        const guildId = getGuildId();
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


