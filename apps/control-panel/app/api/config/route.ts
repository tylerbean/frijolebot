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
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const env = parseEnv(content);
    return NextResponse.json({
      LINK_TRACKER_ENABLED: env.LINK_TRACKER_ENABLED ?? 'true',
      WHATSAPP_ENABLED: env.WHATSAPP_ENABLED ?? 'false',
      WHATSAPP_STORE_MESSAGES: env.WHATSAPP_STORE_MESSAGES ?? 'false',
      monitoredChannels: Object.keys(env)
        .filter(k => k.startsWith('DISCORD_CHANNEL_') && env[k])
        .map(k => ({ key: k, id: env[k] }))
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const env = parseEnv(content);

    if (typeof body.LINK_TRACKER_ENABLED === 'boolean') {
      env.LINK_TRACKER_ENABLED = body.LINK_TRACKER_ENABLED ? 'true' : 'false';
    }
    if (typeof body.WHATSAPP_ENABLED === 'boolean') {
      env.WHATSAPP_ENABLED = body.WHATSAPP_ENABLED ? 'true' : 'false';
    }
    if (typeof body.WHATSAPP_STORE_MESSAGES === 'boolean') {
      env.WHATSAPP_STORE_MESSAGES = body.WHATSAPP_STORE_MESSAGES ? 'true' : 'false';
    }

    if (Array.isArray(body.monitoredChannels)) {
      // Remove existing DISCORD_CHANNEL_*
      for (const k of Object.keys(env)) {
        if (k.startsWith('DISCORD_CHANNEL_')) delete env[k];
      }
      // Write back as DISCORD_CHANNEL_{N}
      body.monitoredChannels.forEach((entry: any, idx: number) => {
        if (entry && entry.id) {
          const key = entry.key && entry.key.startsWith('DISCORD_CHANNEL_') ? entry.key : `DISCORD_CHANNEL_${idx + 1}`;
          env[key] = String(entry.id);
        }
      });
    }

    const updated = serializeEnv(env, content);
    fs.writeFileSync(ENV_PATH, updated);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


