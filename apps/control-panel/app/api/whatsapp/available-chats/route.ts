import { NextResponse } from 'next/server';

// Bridge to the bot: fetch live chats from the bot's health endpoint
export async function GET() {
  try {
    const url = process.env.WHATSAPP_BOT_HEALTH_URL || 'http://localhost:3000/whatsapp/chats';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch from bot' }, { status: res.status });
    }
    const data = await res.json();
    const chats = (data.chats || []).map((c: any) => ({ chat_id: c.id, chat_name: c.name }));
    return NextResponse.json({ chats });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


