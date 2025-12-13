export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { decryptFromB64 } from '@/lib/crypto';

export async function GET() {
  // Read from app_settings.discord with caching
  let token: string | undefined;
  let guildId: string | undefined;

  const settingsCacheKey = 'discord:settings';

  // Try to get settings from cache first
  try {
    const c = await getRedis();
    if (c) {
      const cachedSettings = await c.get(settingsCacheKey);
      if (cachedSettings) {
        const discord = JSON.parse(cachedSettings);
        token = discord.token;
        if (!token && discord.tokenEnc) {
          try { token = decryptFromB64(discord.tokenEnc); } catch (_) {}
        }
        guildId = discord.guildId;
      }
    }
  } catch (_) {}

  // If not in cache, fetch from database
  if (!token || !guildId) {
    try {
      const pool = getPool();
      const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['discord']);
      const discord = res.rows[0]?.value || {};
      token = discord.token;
      if (!token && discord.tokenEnc) {
        try { token = decryptFromB64(discord.tokenEnc); } catch (_) {}
      }
      guildId = discord.guildId;

      // Cache the settings for 1 hour
      try {
        const c = await getRedis();
        if (c) await c.set(settingsCacheKey, JSON.stringify(discord), { EX: 3600 });
      } catch (_) {}
    } catch (_) {}
  }

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

  // Get bot's member data to check permissions
  const botUserRes = await fetch(`https://discord.com/api/v10/users/@me`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store'
  });
  const botUser = botUserRes.ok ? await botUserRes.json() : null;
  const botId = botUser?.id;

  // Filter to text channels and check if bot has access
  const accessibleChannels = [];
  for (const channel of (Array.isArray(data) ? data : [])) {
    if (!channel || typeof channel !== 'object' || channel.type !== 0) continue;

    // Check if bot has VIEW_CHANNEL and SEND_MESSAGES permissions
    // permission_overwrites contains an array of overwrites
    const overwrites = channel.permission_overwrites || [];
    let canView = true; // Default to true unless explicitly denied
    let canSend = true; // Default to true unless explicitly denied

    // Check for @everyone deny
    const everyoneDeny = overwrites.find((ow: any) => ow.id === guildId && ow.type === 0);
    if (everyoneDeny) {
      const denyPerms = BigInt(everyoneDeny.deny || '0');
      if (denyPerms & 1024n) canView = false; // VIEW_CHANNEL denied
      if (denyPerms & 2048n) canSend = false; // SEND_MESSAGES denied
    }

    // Check for bot-specific allow/deny
    if (botId) {
      const botOverwrite = overwrites.find((ow: any) => ow.id === botId && ow.type === 1);
      if (botOverwrite) {
        const allowPerms = BigInt(botOverwrite.allow || '0');
        const denyPerms = BigInt(botOverwrite.deny || '0');

        // Allow overrides everything
        if (allowPerms & 1024n) canView = true;
        if (allowPerms & 2048n) canSend = true;

        // Deny overrides default
        if (denyPerms & 1024n) canView = false;
        if (denyPerms & 2048n) canSend = false;
      }
    }

    // Only include channels where bot can view and send messages
    if (canView && canSend) {
      accessibleChannels.push({ id: channel.id as string, name: channel.name as string });
    }
  }

  const channels = accessibleChannels;
  try {
    const c = await getRedis();
    if (c) await c.set(cacheKey, JSON.stringify({ channels }), { EX: 600 });
  } catch (_) {}
  return NextResponse.json({ channels });
}


