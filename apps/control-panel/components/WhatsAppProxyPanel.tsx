'use client';
import { useEffect, useMemo, useState } from 'react';
import { Switch, Listbox } from '@headlessui/react';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';

type Channel = { id: string; name: string };
type WAChat = { chat_id: string; chat_name: string };
type Mapping = { chatId: string; chatName: string; channelId?: string; isActive?: boolean };

export default function WhatsAppProxyPanel() {
  const [enabled, setEnabled] = useState(false);
  const [store, setStore] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rows, setRows] = useState<Mapping[]>([]);
  const [availableChats, setAvailableChats] = useState<WAChat[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      const [cfg, ch, chats, avail] = await Promise.all([
        fetch('/api/config', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/discord/channels', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/whatsapp/chats', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/whatsapp/available-chats', { cache: 'no-store' }).then(r => r.json()),
      ]);
      setEnabled(String(cfg.WHATSAPP_ENABLED) === 'true');
      setStore(String(cfg.WHATSAPP_STORE_MESSAGES) === 'true');
      setChannels(ch.channels ?? []);
      setRows((chats.chats ?? []).map((c: any) => ({ chatId: c.chat_id, chatName: c.chat_name ?? c.chat_id, channelId: c.discord_channel_id ?? '', isActive: c.is_active })));
      setAvailableChats((avail.chats ?? []).map((c: any) => ({ chat_id: c.chat_id, chat_name: c.chat_name })));
    })();
  }, []);

  const columnHelper = createColumnHelper<Mapping>();
  const columns = useMemo(() => [
    columnHelper.display({
      id: 'chatName',
      header: 'Chat Name',
      cell: ({ row }) => (
        <Listbox value={row.original.chatId} onChange={(v) => updateChat(row.index, v)}>
          <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">
            {row.original.chatName || 'Select a chat'}
          </Listbox.Button>
          <Listbox.Options className="mt-1 max-h-60 w-72 overflow-auto rounded border bg-white shadow">
            {availableChats.map(c => (
              <Listbox.Option key={c.chat_id} value={c.chat_id} className="px-3 py-2 ui-active:bg-indigo-50 cursor-pointer">
                {c.chat_name}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Listbox>
      )
    }),
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
      id: 'enabled',
      header: 'Enabled',
      cell: ({ row }) => (
        <Switch
          checked={!!row.original.isActive}
          onChange={(v) => updateActive(row.index, v)}
          className={`${row.original.isActive ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-5 w-10 items-center rounded-full`}
        >
          <span className={`${row.original.isActive ? 'translate-x-5' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
        </Switch>
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
  function updateChat(index: number, chatId: string) {
    const found = availableChats.find(c => c.chat_id === chatId);
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, chatId, chatName: found?.chat_name ?? chatId }) : r));
  }
  function updateActive(index: number, active: boolean) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, isActive: active }) : r));
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
      const chatsPayload = { chats: rows.filter(r => r.chatId).map(r => ({ chat_id: r.chatId, discord_channel_id: r.channelId || null, is_active: r.isActive ?? true, chat_name: r.chatName || null })) };
      const res2 = await fetch('/api/whatsapp/chats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatsPayload) });
      if (!res2.ok) throw new Error('Failed to save chats');
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


