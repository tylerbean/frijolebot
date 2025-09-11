import { NextResponse } from 'next/server';
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

export async function GET() {
  // Read from root .env for local-only development
  let token: string | undefined;
  let guildId: string | undefined;
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const env = parseEnv(content);
    token = env.DISCORD_BOT_TOKEN;
    guildId = env.DISCORD_GUILD_ID;
  } catch (_) {
    // Fallback to process.env if .env missing
    token = process.env.DISCORD_BOT_TOKEN;
    guildId = process.env.DISCORD_GUILD_ID;
  }
  if (!token || !guildId) {
    return NextResponse.json({ error: 'Missing Discord env vars' }, { status: 500 });
  }
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
  return NextResponse.json({ channels });
}


