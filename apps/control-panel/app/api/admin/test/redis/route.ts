export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '../../../../../lib/db';
import { createClient } from 'redis';

async function getCachingSettings() {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['caching']);
  return res.rows[0]?.value ?? {};
}

export async function POST(req: Request) {
  let client: any;
  try {
    const body = await req.json().catch(() => ({} as any));
    const caching = await getCachingSettings();
    const url = body?.url || caching?.redisUrl;
    if (!url) return NextResponse.json({ ok: false, error: 'missing_redis_url' }, { status: 400 });
    client = createClient({ url });
    await client.connect();
    await client.ping();
    await client.quit();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try { client && (await client.quit()); } catch {}
    return NextResponse.json({ ok: false, error: e.message }, { status: 200 });
  }
}


