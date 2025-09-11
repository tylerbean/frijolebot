import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';

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
    if (!Array.isArray(body.chats)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      const hasChatName = await tableHasColumn(client, 'whatsapp_chats', 'chat_name');
      await client.query('BEGIN');
      for (const row of body.chats) {
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


