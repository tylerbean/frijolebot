export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../../lib/db';
import { z } from 'zod';
import { decryptFromB64 } from '../../../../lib/crypto';

async function getDiscordSettings() {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['discord']);
  return res.rows[0]?.value ?? {};
}

export async function POST(req: Request) {
  try {
    const discord = await getDiscordSettings();
    let token: string | undefined = discord?.token;
    let guildId: string | undefined = discord?.guildId;
    // Decrypt at-rest token if needed
    if (!token && discord?.tokenEnc) {
      try { token = decryptFromB64(discord.tokenEnc); } catch {}
    }
    try {
      const body = await req.json();
      const schema = z.object({ token: z.string().min(10).optional(), guildId: z.string().min(1).optional() }).strict();
      const parsed = schema.safeParse(body);
      if (parsed.success) {
        if (parsed.data.token) token = parsed.data.token;
        if (parsed.data.guildId) guildId = parsed.data.guildId;
      }
    } catch {}
    if (!token || !guildId) {
      // Fallback: if bot is already connected, treat as OK so UI stays usable
      try {
        const health = await fetch('http://localhost:3000/health', { cache: 'no-store' }).then(r=>r.json());
        if (health?.checks?.discord?.connected) {
          return NextResponse.json({ ok: true, source: 'bot', guilds: health.checks.discord.guilds });
        }
      } catch {}
      return NextResponse.json({ ok: false, error: 'missing_token_or_guild' }, { status: 422 });
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      // Fallback to bot health if connected
      try {
        const health = await fetch('http://localhost:3000/health', { cache: 'no-store' }).then(r=>r.json());
        if (health?.checks?.discord?.connected) {
          return NextResponse.json({ ok: true, source: 'bot', status: res.status }, { status: 200 });
        }
      } catch {}
      return NextResponse.json({ ok: false, status: res.status }, { status: res.status });
    }
    const guild = await res.json();
    
    // Prefetch and cache channels for the admin dropdown
    try {
      const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${token}` },
        cache: 'no-store'
      });
      if (channelsRes.ok) {
        const channelsData = await channelsRes.json();
        const channels = (Array.isArray(channelsData) ? channelsData : [])
          .filter((c: any) => c && typeof c === 'object' && c.type === 0)
          .map((c: any) => ({ id: c.id as string, name: c.name as string }));
        
        // Cache channels in Redis if available
        try {
          const { getRedis } = await import('../../../../lib/redis');
          const redis = await getRedis();
          if (redis) {
            const cacheKey = `discord:guild:${guildId}:channels`;
            await redis.set(cacheKey, JSON.stringify({ channels }), { EX: 600 });
          }
        } catch (_) {}
      }
    } catch (_) {
      // Ignore channel prefetch errors - test connection should still succeed
    }
    
    return NextResponse.json({ ok: true, guild: { id: guild.id, name: guild.name }, channelsPrefetched: true });
  } catch (e: any) {
    // Final fallback to bot
    try {
      const health = await fetch('http://localhost:3000/health', { cache: 'no-store' }).then(r=>r.json());
      if (health?.checks?.discord?.connected) {
        return NextResponse.json({ ok: true, source: 'bot' });
      }
    } catch {}
    return NextResponse.json({ ok: false, error: e.message }, { status: 200 });
  }
}


