export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRedis } from '@/lib/redis';

// Bridge to the bot: fetch live chats from the bot's health endpoint
export async function GET() {
  // Try cache first
  const cacheKey = 'whatsapp:available-chats';
  try {
    const c = await getRedis();
    if (c) {
      const hit = await c.get(cacheKey);
      if (hit) {
        return NextResponse.json(JSON.parse(hit));
      }
    }
  } catch (_) {}

  let chatsResult: any[] = [];

  // Try live list from the bot first (Baileys); fallback to DB if unavailable
  try {
    const url = process.env.WHATSAPP_BOT_HEALTH_URL || 'http://localhost:3000/whatsapp/chats';
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal }).catch(() => null);
    clearTimeout(t);
    if (res && res.ok) {
      const data = await res.json();
      const chats = (data.chats || []).map((c: any) => ({ chat_id: c.id, chat_name: c.name }));
      if (chats.length > 0) {
        chatsResult = chats;
      }
    }
  } catch (_) {}

  // Fallback: use configured chats from DB so UI remains usable
  if (chatsResult.length === 0) {
    try {
      const pool = getPool();
      const result = await pool.query(`SELECT chat_id, COALESCE(NULLIF(chat_name, ''), chat_id) AS chat_name FROM whatsapp_chats ORDER BY updated_at DESC NULLS LAST, created_at DESC`);
      chatsResult = result.rows.map((r: any) => ({ chat_id: r.chat_id, chat_name: r.chat_name }));
    } catch (e: any) {
      chatsResult = [];
    }
  }

  const payload = { chats: chatsResult };

  // Cache the result for 1 minute
  try {
    const c = await getRedis();
    if (c) await c.set(cacheKey, JSON.stringify(payload), { EX: 60 });
  } catch (_) {}

  return NextResponse.json(payload);
}


