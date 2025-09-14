export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const schema = z.object({ token: z.string().min(10), guildId: z.string().min(1) }).strict();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 422 });
    const { token, guildId } = parsed.data;
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store'
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status }, { status: res.status });
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



