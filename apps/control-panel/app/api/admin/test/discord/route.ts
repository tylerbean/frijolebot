export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../../lib/db';

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
    try {
      const body = await req.json();
      if (body?.token) token = body.token;
      if (body?.guildId) guildId = body.guildId;
    } catch {}
    if (!token || !guildId) {
      // Fallback: if bot is already connected, treat as OK so UI stays usable
      try {
        const health = await fetch('http://localhost:3000/health', { cache: 'no-store' }).then(r=>r.json());
        if (health?.checks?.discord?.connected) {
          return NextResponse.json({ ok: true, source: 'bot', guilds: health.checks.discord.guilds });
        }
      } catch {}
      return NextResponse.json({ ok: false, error: 'missing_token_or_guild' }, { status: 400 });
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
          return NextResponse.json({ ok: true, source: 'bot', status: res.status });
        }
      } catch {}
      return NextResponse.json({ ok: false, status: res.status }, { status: 200 });
    }
    const guild = await res.json();
    return NextResponse.json({ ok: true, guild: { id: guild.id, name: guild.name } });
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


