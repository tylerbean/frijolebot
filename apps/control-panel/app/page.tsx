export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { getPool } from './lib/db';

async function getFlags() {
  try {
    const pool = getPool();
    const discord = await pool.query(`SELECT value FROM app_settings WHERE key = 'discord'`);
    const whatsapp = await pool.query(`SELECT value FROM app_settings WHERE key = 'whatsapp'`);
    const LINK_TRACKER_ENABLED = !!discord.rows[0]?.value?.enabled;
    const WHATSAPP_ENABLED = !!whatsapp.rows[0]?.value?.enabled;
    return { LINK_TRACKER_ENABLED, WHATSAPP_ENABLED } as Record<string, boolean>;
  } catch {
    return { LINK_TRACKER_ENABLED: false, WHATSAPP_ENABLED: false };
  }
}

export default async function Page() {
  const flags = await getFlags();
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">FrijoleBot Control Panel</h1>
        <Link href="/admin" className="rounded bg-slate-800 px-3 py-2 text-white">Admin</Link>
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        {flags.LINK_TRACKER_ENABLED && (
          <Link href="/link-tracker" className="rounded-lg border bg-white p-4 shadow-sm hover:shadow">
            <h2 className="font-medium">Discord Link Tracker</h2>
            <p className="text-sm text-gray-600">Toggle and configure monitored channels.</p>
          </Link>
        )}
        {flags.WHATSAPP_ENABLED && (
          <Link href="/whatsapp-proxy" className="rounded-lg border bg-white p-4 shadow-sm hover:shadow">
            <h2 className="font-medium">WhatsApp Proxy</h2>
            <p className="text-sm text-gray-600">Enable, store messages, and map chats to channels.</p>
          </Link>
        )}
      </section>
    </main>
  );
}


