import Link from 'next/link';
import LinkTrackerPanel from '../../components/LinkTrackerPanel';

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Discord Link Tracker</h1>
        <Link href="/" className="rounded border px-3 py-2 hover:bg-gray-50">← Back</Link>
      </div>
      <LinkTrackerPanel />
    </main>
  );
}



