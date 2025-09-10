'use client';
import { useEffect, useMemo, useState } from 'react';
import { Switch, Listbox } from '@headlessui/react';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';

type Channel = { id: string; name: string };
type Mapping = { chatId: string; chatName: string; channelId?: string };

export default function WhatsAppProxyPanel() {
  const [enabled, setEnabled] = useState(false);
  const [store, setStore] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rows, setRows] = useState<Mapping[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      const [cfg, ch] = await Promise.all([
        fetch('/api/config', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/discord/channels', { cache: 'no-store' }).then(r => r.json()),
      ]);
      setEnabled(String(cfg.WHATSAPP_ENABLED) === 'true');
      setStore(String(cfg.WHATSAPP_STORE_MESSAGES) === 'true');
      setChannels(ch.channels ?? []);
      // Placeholder: actual chat mappings would come from a dedicated API
      setRows([]);
    })();
  }, []);

  const columnHelper = createColumnHelper<Mapping>();
  const columns = useMemo(() => [
    columnHelper.accessor('chatName', { header: 'WhatsApp Conversation' }),
    columnHelper.display({
      id: 'channel',
      header: 'Discord Channel',
      cell: ({ row }) => (
        <Listbox value={row.original.channelId ?? ''} onChange={(v) => updateRow(row.index, v)}>
          <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">
            {channels.find(c => c.id === row.original.channelId)?.name ?? 'Select a channel'}
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
    setRows(prev => [...prev, { chatId: '', chatName: 'New Mapping', channelId: '' }]);
  }
  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, channelId: string) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, channelId }) : r));
  }

  async function save() {
    setPending(true);
    try {
      const payload = {
        WHATSAPP_ENABLED: enabled,
        WHATSAPP_STORE_MESSAGES: store,
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
            <h2 className="font-medium">Enable WhatsApp Proxy</h2>
            <p className="text-sm text-gray-600">Turn WhatsApp message forwarding on or off.</p>
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
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Store Messages</h2>
            <p className="text-sm text-gray-600">Persist WhatsApp messages for audit/history.</p>
          </div>
          <Switch
            checked={store}
            onChange={setStore}
            className={`${store ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full`}
          >
            <span className={`${store ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
      </div>

      <div className="rounded border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Conversation / Channel Mapping</h3>
          <button onClick={addRow} className="rounded bg-indigo-600 px-3 py-2 text-white">Add Mapping</button>
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


