export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { oldGuildId, newGuildId } = body;

    if (!oldGuildId || !newGuildId) {
      return NextResponse.json({ error: 'Missing oldGuildId or newGuildId' }, { status: 400 });
    }

    if (oldGuildId === newGuildId) {
      return NextResponse.json({ error: 'Old and new guild IDs are the same' }, { status: 400 });
    }

    const pool = getPool();

    // Count existing mappings that will be wiped
    const [discordLinksResult, discordChannelsResult, whatsappChatsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM discord_links WHERE guild_id = $1', [oldGuildId]),
      pool.query('SELECT COUNT(*) FROM discord_links_channels WHERE guild_id = $1', [oldGuildId]),
      pool.query('SELECT COUNT(*) FROM whatsapp_chats WHERE discord_guild_id = $1', [oldGuildId])
    ]);

    const discordLinksCount = parseInt(discordLinksResult.rows[0]?.count || '0');
    const discordChannelsCount = parseInt(discordChannelsResult.rows[0]?.count || '0');
    const whatsappChatsCount = parseInt(whatsappChatsResult.rows[0]?.count || '0');

    // Start transaction to wipe all mappings
    await pool.query('BEGIN');

    try {
      // Delete Discord tracker data
      await pool.query('DELETE FROM discord_links WHERE guild_id = $1', [oldGuildId]);
      await pool.query('DELETE FROM discord_links_channels WHERE guild_id = $1', [oldGuildId]);
      await pool.query('DELETE FROM discord_dm_mappings WHERE guild_id = $1', [oldGuildId]);

      // Delete WhatsApp proxy channel mappings
      await pool.query('DELETE FROM whatsapp_chats WHERE discord_guild_id = $1', [oldGuildId]);

      await pool.query('COMMIT');

      return NextResponse.json({
        ok: true,
        wiped: {
          discordLinks: discordLinksCount,
          discordChannels: discordChannelsCount,
          whatsappChats: whatsappChatsCount
        }
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (e: any) {
    console.error('Guild migration error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}