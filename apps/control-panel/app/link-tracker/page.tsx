import Link from 'next/link';
import LinkTrackerPanel from '../../components/LinkTrackerPanel';

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">LinkTracker</h1>
        <Link href="/" className="text-sm text-indigo-600">Back</Link>
      </div>
      <LinkTrackerPanel />
    </main>
  );
}



