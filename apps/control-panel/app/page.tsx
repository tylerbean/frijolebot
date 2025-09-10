import Link from 'next/link';

export default async function Page() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">FrijoleBot Control Panel</h1>
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/link-tracker" className="rounded-lg border bg-white p-4 shadow-sm hover:shadow">
          <h2 className="font-medium">LinkTracker</h2>
          <p className="text-sm text-gray-600">Toggle and configure monitored channels.</p>
        </Link>
        <Link href="/whatsapp-proxy" className="rounded-lg border bg-white p-4 shadow-sm hover:shadow">
          <h2 className="font-medium">WhatsApp Proxy</h2>
          <p className="text-sm text-gray-600">Enable, store messages, and map chats to channels.</p>
        </Link>
      </section>
    </main>
  );
}


