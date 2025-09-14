export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';
import { createClient } from 'redis';
import { z } from 'zod';
import { URL } from 'url';

async function getCachingSettings() {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['caching']);
  return res.rows[0]?.value ?? {};
}

export async function POST(req: Request) {
  let client: any;
  try {
    // Allow testing either a provided URL (unsaved) or the server-configured one
    const caching = await getCachingSettings();
    const body = await req.json().catch(() => ({}));
    const schema = z.object({
      redisUrl: z.preprocess((v)=> (typeof v === 'string' && v.trim() === '' ? null : v), z.string().min(1).nullable().optional())
    }).strip();
    const validated = schema.safeParse(body);
    const candidate = validated.success && validated.data.redisUrl ? String(validated.data.redisUrl) : (caching?.redisUrl == null ? '' : String(caching.redisUrl));

    const urlStr = candidate;
    if (!urlStr.trim()) return NextResponse.json({ ok: false, code: 'missing_redis_url', error: 'No Redis URL configured. Save a Redis URL first.' }, { status: 400 });

    // Basic SSRF protection: enforce scheme and use only server-configured URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return NextResponse.json({ ok: false, code: 'invalid_url', error: 'Invalid Redis URL format.' }, { status: 422 });
    }
    const allowedSchemes = new Set(['redis:', 'rediss:']);
    if (!allowedSchemes.has(parsedUrl.protocol)) {
      return NextResponse.json({ ok: false, code: 'invalid_scheme', error: 'Redis URL must start with redis:// or rediss://.' }, { status: 422 });
    }

    client = createClient({ url: urlStr });
    await client.connect();
    await client.ping();
    await client.quit();
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    try { client && (await client.quit()); } catch {}
    return NextResponse.json({ ok: false, code: 'connection_failed', error: e.message }, { status: 502 });
  }
}


