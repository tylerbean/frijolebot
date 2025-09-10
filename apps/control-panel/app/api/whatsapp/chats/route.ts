import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';

export async function GET() {
  try {
    const pool = getPool();
    const res = await pool.query('SELECT chat_id, discord_channel_id, is_active FROM whatsapp_chats ORDER BY created_at DESC');
    return NextResponse.json({ chats: res.rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.chats)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of body.chats) {
        if (!row || typeof row.chat_id !== 'string') continue;
        await client.query(
          `INSERT INTO whatsapp_chats (chat_id, discord_channel_id, is_active)
           VALUES ($1, $2, COALESCE($3, TRUE))
           ON CONFLICT (chat_id)
           DO UPDATE SET discord_channel_id = EXCLUDED.discord_channel_id, is_active = EXCLUDED.is_active, updated_at = CURRENT_TIMESTAMP`,
          [row.chat_id, row.discord_channel_id ?? null, row.is_active ?? true]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


