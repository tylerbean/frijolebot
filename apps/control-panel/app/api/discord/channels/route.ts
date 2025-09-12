export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';
import { getRedis } from '../../../../lib/redis';

export async function GET() {
  // Read from app_settings.discord
  let token: string | undefined;
  let guildId: string | undefined;
  try {
    const pool = getPool();
    const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['discord']);
    const discord = res.rows[0]?.value || {};
    token = discord.token;
    guildId = discord.guildId;
  } catch (_) {}
  if (!token || !guildId) {
    return NextResponse.json({ error: 'Missing Discord env vars' }, { status: 500 });
  }
  // Try cache first
  const cacheKey = `discord:guild:${guildId}:channels`;
  try {
    const c = await getRedis();
    if (c) {
      const hit = await c.get(cacheKey);
      if (hit) {
        return NextResponse.json(JSON.parse(hit));
      }
    }
  } catch (_) {}
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store'
  });
  if (!res.ok) {
    // Fail-soft: return empty list so UI stays functional
    return NextResponse.json({ channels: [] }, { status: 200 });
  }
  const data = await res.json();
  const channels = (Array.isArray(data) ? data : [])
    .filter((c: any) => c && typeof c === 'object' && c.type === 0)
    .map((c: any) => ({ id: c.id as string, name: c.name as string }));
  try {
    const c = await getRedis();
    if (c) await c.set(cacheKey, JSON.stringify({ channels }), { EX: 600 });
  } catch (_) {}
  return NextResponse.json({ channels });
}


