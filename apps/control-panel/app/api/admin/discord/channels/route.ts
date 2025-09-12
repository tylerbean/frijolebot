export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token: string | undefined = body?.token;
    const guildId: string | undefined = body?.guildId;
    if (!token || !guildId) {
      return NextResponse.json({ ok: false, error: 'missing_token_or_guild' }, { status: 400 });
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store'
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status }, { status: 200 });
    }
    const data = await res.json();
    const channels = (Array.isArray(data) ? data : [])
      .filter((c: any) => c && typeof c === 'object' && c.type === 0)
      .map((c: any) => ({ id: String(c.id), name: String(c.name) }));
    return NextResponse.json({ ok: true, channels });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}



