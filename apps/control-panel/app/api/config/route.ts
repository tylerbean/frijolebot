export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(process.cwd(), '..', '..', '.env');

function parseEnv(content: string): Record<string, string> {
  const lines = content.split('\n');
  const out: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

function serializeEnv(obj: Record<string, string>, original: string): string {
  // Preserve original ordering/comments where possible
  const lines = original.split('\n');
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx === -1 || line.trim().startsWith('#')) {
      result.push(line);
      continue;
    }
    const key = line.slice(0, idx).trim();
    if (key in obj) {
      result.push(`${key}=${obj[key]}`);
      seen.add(key);
    } else {
      result.push(line);
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!seen.has(k)) result.push(`${k}=${v}`);
  }
  return result.join('\n');
}

export async function GET() {
  try {
    const { getPool } = await import('../../../lib/db');
    const pool = getPool();
    const flags = await pool.query(`SELECT key, value FROM feature_flags WHERE key IN ('LINK_TRACKER_ENABLED','WHATSAPP_ENABLED','WHATSAPP_STORE_MESSAGES')`);
    const asMap: Record<string, boolean> = Object.fromEntries(flags.rows.map((r: any) => [r.key, !!r.value]));
    return NextResponse.json({
      LINK_TRACKER_ENABLED: String(asMap.LINK_TRACKER_ENABLED ?? 'true'),
      WHATSAPP_ENABLED: String(asMap.WHATSAPP_ENABLED ?? 'false'),
      WHATSAPP_STORE_MESSAGES: String(asMap.WHATSAPP_STORE_MESSAGES ?? 'false')
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { getPool } = await import('../../../lib/db');
    const pool = getPool();
    const prevRes = await pool.query(`SELECT key, value FROM feature_flags WHERE key IN ('LINK_TRACKER_ENABLED','WHATSAPP_ENABLED','WHATSAPP_STORE_MESSAGES')`);
    const prevMap: Record<string, boolean> = Object.fromEntries(prevRes.rows.map((r: any) => [r.key, !!r.value]));

    const updates: Array<{ key: string, value: boolean }> = [];
    if (typeof body.LINK_TRACKER_ENABLED === 'boolean') updates.push({ key: 'LINK_TRACKER_ENABLED', value: body.LINK_TRACKER_ENABLED });
    if (typeof body.WHATSAPP_ENABLED === 'boolean') updates.push({ key: 'WHATSAPP_ENABLED', value: body.WHATSAPP_ENABLED });
    if (typeof body.WHATSAPP_STORE_MESSAGES === 'boolean') updates.push({ key: 'WHATSAPP_STORE_MESSAGES', value: body.WHATSAPP_STORE_MESSAGES });

    for (const u of updates) {
      await pool.query(
        `INSERT INTO feature_flags(key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [u.key, u.value]
      );
    }

    // Notify bot of feature toggles or reloads
    try {
      const base = process.env.WHATSAPP_BOT_HEALTH_URL || 'http://localhost:3000/whatsapp/chats';
      const url = base.replace('/whatsapp/chats', '/admin/notify');
      const token = process.env.ADMIN_NOTIFY_TOKEN || process.env.NEXT_PUBLIC_ADMIN_NOTIFY_TOKEN;
      const events: Array<{ type: string, payload: any }> = [];
      if (typeof body.LINK_TRACKER_ENABLED === 'boolean') {
        const changed = prevMap.LINK_TRACKER_ENABLED !== body.LINK_TRACKER_ENABLED;
        events.push({ type: changed ? 'feature_toggle' : 'feature_reloaded', payload: { name: 'LinkTracker', enabled: body.LINK_TRACKER_ENABLED } });
      }
      if (typeof body.WHATSAPP_ENABLED === 'boolean') {
        const changed = prevMap.WHATSAPP_ENABLED !== body.WHATSAPP_ENABLED;
        events.push({ type: changed ? 'feature_toggle' : 'feature_reloaded', payload: { name: 'WhatsApp', enabled: body.WHATSAPP_ENABLED } });
      }
      if (typeof body.WHATSAPP_STORE_MESSAGES === 'boolean') {
        const changed = prevMap.WHATSAPP_STORE_MESSAGES !== body.WHATSAPP_STORE_MESSAGES;
        events.push({ type: changed ? 'feature_toggle' : 'feature_reloaded', payload: { name: 'WhatsApp Store Messages', enabled: body.WHATSAPP_STORE_MESSAGES } });
      }
      for (const evt of events) {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
          body: JSON.stringify(evt)
        });
      }
      // Publish flag invalidation on Redis so bots refresh cached values immediately
      try {
        const { invalidateFlags } = await import('../../../lib/redis');
        await invalidateFlags(updates.map(u => u.key));
      } catch (_) {}
    } catch (_) {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


