import Link from 'next/link';
import WhatsAppProxyPanel from '../../components/WhatsAppProxyPanel';

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6" style={{ overflow: 'visible', position: 'relative' }}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">WhatsApp Proxy</h1>
        <Link href="/" className="text-sm text-indigo-600">Back</Link>
      </div>
      <WhatsAppProxyPanel />
    </main>
  );
}



