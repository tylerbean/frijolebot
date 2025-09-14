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
    const { getPool } = await import('@/lib/db');
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
  // Deprecated: feature toggles are managed in /api/admin/settings. Keep endpoint for legacy clients.
  return NextResponse.json({ error: 'deprecated', message: 'Use /api/admin/settings instead.' }, { status: 410 });
}


