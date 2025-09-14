export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { z } from 'zod';

async function tableHasColumn(client: any, table: string, column: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return res.rowCount > 0;
}

export async function GET() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const hasChatName = await tableHasColumn(client, 'whatsapp_chats', 'chat_name');
    const select = hasChatName
      ? `SELECT chat_id, discord_channel_id, is_active, chat_name FROM whatsapp_chats ORDER BY created_at DESC`
      : `SELECT chat_id, discord_channel_id, is_active FROM whatsapp_chats ORDER BY created_at DESC`;
    const res = await client.query(select);
    const rows = res.rows.map((r: any) => ({
      chat_id: r.chat_id,
      discord_channel_id: r.discord_channel_id,
      is_active: r.is_active,
      chat_name: hasChatName ? r.chat_name ?? null : null
    }));
    return NextResponse.json({ chats: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const chatSchema = z.object({
      chat_id: z.string().min(5).max(128),
      discord_channel_id: z.string().min(0).max(64).nullable().optional(),
      is_active: z.boolean().optional(),
      chat_name: z.string().min(1).max(255).nullable().optional()
    }).strict();
    const schema = z.object({ chats: z.array(chatSchema).max(1000) }).strict();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 422 });
    const pool = getPool();
    const client = await pool.connect();
    try {
      const hasChatName = await tableHasColumn(client, 'whatsapp_chats', 'chat_name');
      await client.query('BEGIN');
      for (const row of parsed.data.chats) {
        if (!row || typeof row.chat_id !== 'string') continue;
        if (hasChatName) {
          await client.query(
            `INSERT INTO whatsapp_chats (chat_id, discord_channel_id, is_active, chat_name)
             VALUES ($1, $2, COALESCE($3, TRUE), $4)
             ON CONFLICT (chat_id)
             DO UPDATE SET discord_channel_id = EXCLUDED.discord_channel_id, is_active = EXCLUDED.is_active, chat_name = EXCLUDED.chat_name, updated_at = CURRENT_TIMESTAMP`,
            [row.chat_id, row.discord_channel_id ?? null, row.is_active ?? true, row.chat_name ?? null]
          );
        } else {
          await client.query(
            `INSERT INTO whatsapp_chats (chat_id, discord_channel_id, is_active)
             VALUES ($1, $2, COALESCE($3, TRUE))
             ON CONFLICT (chat_id)
             DO UPDATE SET discord_channel_id = EXCLUDED.discord_channel_id, is_active = EXCLUDED.is_active, updated_at = CURRENT_TIMESTAMP`,
            [row.chat_id, row.discord_channel_id ?? null, row.is_active ?? true]
          );
        }
      }
      // Deletion-on-save: remove any rows not present in submitted list
      const ids = parsed.data.chats.filter((r: any) => r && typeof r.chat_id === 'string').map((r: any) => r.chat_id);
      if (ids.length === 0) {
        await client.query(`DELETE FROM whatsapp_chats`);
      } else {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        await client.query(`DELETE FROM whatsapp_chats WHERE chat_id NOT IN (${placeholders})`, ids);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Notify bot admin channel
    try {
      const url = process.env.WHATSAPP_BOT_HEALTH_URL?.replace('/whatsapp/chats', '/admin/notify') || 'http://localhost:3000/admin/notify';
      const token = process.env.ADMIN_NOTIFY_TOKEN || process.env.NEXT_PUBLIC_ADMIN_NOTIFY_TOKEN;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
        body: JSON.stringify({ type: 'whatsapp_mappings_updated', payload: { items: parsed.data.chats } })
      });
      // ignore response
    } catch (_) {}
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


