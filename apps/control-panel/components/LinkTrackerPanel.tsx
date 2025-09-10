'use client';
import { useEffect, useMemo, useState } from 'react';
import { Switch, Listbox } from '@headlessui/react';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';

type Channel = { id: string; name: string };
type RowData = { key: string; name: string; id: string };

export default function LinkTrackerPanel() {
  const [enabled, setEnabled] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      const [cfg, ch] = await Promise.all([
        fetch('/api/config', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/discord/channels', { cache: 'no-store' }).then(r => r.json()),
      ]);
      setEnabled(String(cfg.LINK_TRACKER_ENABLED) === 'true');
      setRows((cfg.monitoredChannels ?? []).map((e: any) => ({ key: e.key, id: e.id, name: e.id })));
      setChannels(ch.channels ?? []);
    })();
  }, []);

  // Hydrate names for existing IDs when channels are loaded
  useEffect(() => {
    if (channels.length === 0) return;
    setRows(prev => prev.map(r => ({ ...r, name: channels.find(c => c.id === r.id)?.name ?? r.name })));
  }, [channels]);

  const columnHelper = createColumnHelper<RowData>();
  const columns = useMemo(() => [
    columnHelper.display({
      id: 'name',
      header: 'Channel',
      cell: ({ row }) => row.original.name
    }),
    columnHelper.display({
      id: 'selector',
      header: 'Select',
      cell: ({ row }) => (
        <Listbox value={row.original.id} onChange={(v) => updateRow(row.index, v)}>
          <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">
            {channels.find(c => c.id === row.original.id)?.name ?? 'Select a channel'}
          </Listbox.Button>
          <Listbox.Options className="mt-1 max-h-60 w-64 overflow-auto rounded border bg-white shadow">
            {channels.map(c => (
              <Listbox.Option key={c.id} value={c.id} className="px-3 py-2 ui-active:bg-indigo-50 cursor-pointer">
                {c.name}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Listbox>
      )
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <button className="text-red-600" onClick={() => removeRow(row.index)}>Remove</button>
      )
    }),
  ], [channels]);

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  function addRow() {
    setRows(prev => [...prev, { key: '', id: '', name: 'Select a channel' }]);
  }
  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, id: string) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, id, name: channels.find(c => c.id === id)?.name ?? id }) : r));
  }

  async function save() {
    setPending(true);
    try {
      const payload = {
        LINK_TRACKER_ENABLED: enabled,
        monitoredChannels: rows.filter(r => r.id).map(r => ({ key: r.key, id: r.id }))
      };
      const res = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed to save');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Enable LinkTracker</h2>
            <p className="text-sm text-gray-600">Gate URL tracking via feature flag.</p>
          </div>
          <Switch
            checked={enabled}
            onChange={setEnabled}
            className={`${enabled ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full`}
          >
            <span className={`${enabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
      </div>

      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Monitored Channels</h3>
          <button onClick={addRow} className="rounded bg-indigo-600 px-3 py-2 text-white">Add</button>
        </div>
        <div className="overflow-hidden rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>{hg.headers.map(h => (
                  <th key={h.id} className="px-4 py-2 text-left font-medium text-gray-700">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}</tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(r => (
                <tr key={r.id} className="border-t">
                  {r.getVisibleCells().map(c => (
                    <td key={c.id} className="px-4 py-2">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <button disabled={pending} onClick={save} className="rounded bg-green-600 px-3 py-2 text-white disabled:opacity-50">Save Changes</button>
        </div>
      </div>
    </div>
  );
}


