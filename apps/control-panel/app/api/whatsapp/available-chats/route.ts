import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';

export async function GET() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // Prefer rows with chat_name when present
    const res = await client.query(
      `SELECT chat_id, NULLIF(chat_name, '') AS chat_name, is_active
       FROM whatsapp_chats
       ORDER BY updated_at DESC NULLS LAST, created_at DESC`
    );
    const rows = res.rows.map((r: any) => ({
      chat_id: r.chat_id,
      chat_name: r.chat_name ?? r.chat_id,
      is_active: r.is_active,
    }));
    return NextResponse.json({ chats: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    client.release();
  }
}


