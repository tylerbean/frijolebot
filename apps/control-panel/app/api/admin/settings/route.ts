export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';

type Settings = {
  discord?: {
    enabled?: boolean;
    token?: string;
    guildId?: string;
    adminChannelId?: string;
    linkTrackerEnabled?: boolean;
  };
  whatsapp?: {
    enabled?: boolean;
    storeMessages?: boolean;
  };
  timezone?: {
    tz?: string;
  };
  caching?: {
    redisUrl?: string;
  };
  rateLimit?: {
    enabled?: boolean;
    windowSec?: number;
    maxRequests?: number;
    cleanupIntervalSec?: number;
  };
};

async function getSetting(key: string) {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return res.rows[0]?.value ?? null;
}

async function setSetting(key: string, value: any) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO app_settings(key, value, updated_at) VALUES($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}

export async function GET() {
  try {
    const discord = (await getSetting('discord')) || { enabled: false };
    const whatsapp = (await getSetting('whatsapp')) || { enabled: false, storeMessages: false };
    const timezone = (await getSetting('timezone')) || { tz: 'UTC' };
    const caching = (await getSetting('caching')) || { redisUrl: '', enabled: false };
    const rateLimit = (await getSetting('rateLimit')) || {
      enabled: true,
      windowSec: 60,
      maxRequests: 5,
      cleanupIntervalSec: 300,
    };
    const data: Settings = { discord, whatsapp, timezone, caching, rateLimit };
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Settings;
    const notifyUrl = process.env.WHATSAPP_BOT_HEALTH_URL?.replace('/whatsapp/chats', '/admin/notify') || 'http://localhost:3000/admin/notify';
    const adminToken = process.env.ADMIN_NOTIFY_TOKEN || process.env.NEXT_PUBLIC_ADMIN_NOTIFY_TOKEN;
    if (body.discord) {
      const prev = await getSetting('discord');
      // If disabling, notify BEFORE persisting so Discord can send message
      if (typeof body.discord.enabled === 'boolean' && prev && prev.enabled === true && body.discord.enabled === false) {
        try {
          const channelId = body.discord.adminChannelId || prev.adminChannelId || '';
          await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
            body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'Discord', enabled: false, message: 'Discord Link Tracker is being disabled', channelId } })
          }).catch(()=>{});
        } catch {}
      }

      await setSetting('discord', body.discord);

      // Sync feature_flags for legacy gating
      try {
        const pool = getPool();
        if (typeof body.discord.enabled === 'boolean') {
          await pool.query(`INSERT INTO feature_flags(key, value) VALUES ('LINK_TRACKER_ENABLED', $1) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [!!body.discord.enabled]);
        }
      } catch {}

      // If enabling, send a status summary
      if (typeof body.discord.enabled === 'boolean' && body.discord.enabled === true && (!prev || prev.enabled !== true)) {
        try {
          // Build monitored channels list from DB
          const pool = getPool();
          const guildId = body.discord.guildId || prev?.guildId;
          let channelLines: string[] = [];
          if (guildId) {
            const res = await pool.query('SELECT channel_id, channel_name, is_active FROM discord_links_channels WHERE guild_id = $1', [guildId]);
            const active = res.rows.filter((r:any)=>r.is_active !== false);
            channelLines = active.map((r:any)=> r.channel_name ? `#${r.channel_name} (${r.channel_id})` : r.channel_id);
          }
          const statusText = channelLines.length ? `Monitoring channels (${channelLines.length}):\n${channelLines.map(l=>`• ${l}`).join('\n')}` : 'Monitoring channels: none';
          // Announce enabled
          const channelId = body.discord.adminChannelId || prev?.adminChannelId || '';
          await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
            body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'Discord', enabled: true, channelId } })
          }).catch(()=>{});
          await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
            body: JSON.stringify({ type: 'service_status', payload: { name: 'Discord', enabled: true, statusText, channelId } })
          }).catch(()=>{});
        } catch {}
      }
      // If adminChannelId changed to a non-empty value, notify bot
      try {
        const before = prev?.adminChannelId || '';
        const after = body.discord.adminChannelId || '';
        if (after && after !== before) {
          await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
            body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'AdminChannel', enabled: true, channelId: after } })
          }).catch(()=>{});
          // Also prime feature flag for UI tile visibility
          const pool = getPool();
          await pool.query(`INSERT INTO feature_flags(key, value) VALUES ('LINK_TRACKER_ENABLED', TRUE) ON CONFLICT(key) DO UPDATE SET value = TRUE, updated_at = CURRENT_TIMESTAMP`);
        }
      } catch {}
    }
    if (body.whatsapp) {
      const prev = await getSetting('whatsapp');
      await setSetting('whatsapp', body.whatsapp);
      // sync feature flag for bot gating
      try {
        const pool = getPool();
        if (typeof body.whatsapp.enabled === 'boolean') {
          await pool.query(`INSERT INTO feature_flags(key, value) VALUES ('WHATSAPP_ENABLED', $1) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [!!body.whatsapp.enabled]);
        }
      } catch {}
      try {
        // resolve admin channel to target
        const discordCfg = await getSetting('discord');
        const channelId = discordCfg?.adminChannelId || '';
        // Notify storeMessages change
        try {
          const beforeStore = !!(prev && prev.storeMessages);
          const afterStore = !!body.whatsapp.storeMessages;
          if (prev && beforeStore !== afterStore) {
            await fetch(notifyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
              body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'WhatsApp Store Messages', enabled: afterStore, channelId } })
            }).catch(()=>{});
          }
        } catch {}
        // Notify toggle state
        await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
          body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'WhatsApp', enabled: !!body.whatsapp.enabled, channelId } })
        }).catch(()=>{});
        // If enabling, send status summary (count of chats available)
        if ((!prev || prev.enabled !== true) && body.whatsapp.enabled === true) {
          let statusText = '';
          try {
            const chatsUrl = process.env.WHATSAPP_BOT_HEALTH_URL || 'http://localhost:3000/whatsapp/chats';
            const r = await fetch(chatsUrl).then(r=>r.json());
            const n = Array.isArray(r?.chats) ? r.chats.length : 0;
            statusText = `WhatsApp available chats: ${n}`;
          } catch { statusText = 'WhatsApp status: unknown'; }
          await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
            body: JSON.stringify({ type: 'service_status', payload: { name: 'WhatsApp', enabled: true, statusText, channelId } })
          }).catch(()=>{});
        }
      } catch {}
    }
    if (body.timezone) {
      await setSetting('timezone', body.timezone);
      try {
        const discordCfg = await getSetting('discord');
        const channelId = discordCfg?.adminChannelId || '';
        console.log('[admin] timezone updated to', body.timezone.tz);
        await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
          body: JSON.stringify({ type: 'timezone_updated', payload: { tz: body.timezone.tz, channelId } })
        }).catch(()=>{});
      } catch {}
    }
    if (body.caching) {
      await setSetting('caching', body.caching);
      try {
        const discordCfg = await getSetting('discord');
        const channelId = discordCfg?.adminChannelId || '';
        console.log('[admin] caching redisUrl updated');
        await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
          body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'Caching', enabled: !!body.caching.enabled, message: 'Redis settings saved', channelId } })
        }).catch(()=>{});
      } catch {}
    }
    if (body.rateLimit) {
      await setSetting('rateLimit', body.rateLimit);
      try {
        const discordCfg = await getSetting('discord');
        const channelId = discordCfg?.adminChannelId || '';
        console.log('[admin] rate limit updated', body.rateLimit);
        await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
          body: JSON.stringify({ type: 'feature_toggle', payload: { name: 'Rate Limit', enabled: !!body.rateLimit.enabled, message: `window=${body.rateLimit.windowSec}s, max=${body.rateLimit.maxRequests}, cleanup=${body.rateLimit.cleanupIntervalSec}s`, channelId } })
        }).catch(()=>{});
      } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


