export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { createClient } from 'redis';

async function getCachingSettings() {
  const pool = getPool();
  const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', ['caching']);
  return res.rows[0]?.value ?? {};
}

export async function GET() {
  let client: any;
  try {
    const caching = await getCachingSettings();

    // If caching is disabled or no URL configured, return disabled status
    if (!caching?.enabled || !caching?.redisUrl || String(caching.redisUrl).trim() === '') {
      return NextResponse.json({
        connected: false,
        enabled: false,
        reason: 'disabled'
      });
    }

    const urlStr = String(caching.redisUrl).trim();

    // Create client with 2s timeout
    client = createClient({
      url: urlStr,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: false
      }
    });

    // Suppress error logging for status checks
    client.on('error', () => {});

    // Wrap connect/ping in a timeout promise
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 2000)
    );

    await Promise.race([
      (async () => {
        await client.connect();
        await client.ping();
        await client.quit();
      })(),
      timeoutPromise
    ]);

    return NextResponse.json({
      connected: true,
      enabled: true
    });
  } catch (e: any) {
    try {
      if (client) {
        await client.quit().catch(() => {});
      }
    } catch {}

    return NextResponse.json({
      connected: false,
      enabled: true,
      error: e.message || 'connection_failed'
    });
  }
}
