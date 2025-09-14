'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Switch, Listbox, Portal } from '@headlessui/react';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';

type Channel = { id: string; name: string };
type WAChat = { chat_id: string; chat_name: string };
type Mapping = { chatId: string; chatName: string; channelId?: string; isActive?: boolean };

export default function WhatsAppProxyPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [store, setStore] = useState<boolean | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rows, setRows] = useState<Mapping[]>([]);
  const [availableChats, setAvailableChats] = useState<WAChat[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    (async () => {
      // Settings now configured via Admin page; do not read feature flags here
      setEnabled(null);
      setStore(null);

      try {
        const ch = await fetch('/api/discord/channels', { cache: 'no-store' }).then(r => r.json());
        setChannels(ch.channels ?? []);
      } catch (_) { setChannels([]); }

      try {
        const chats = await fetch('/api/whatsapp/chats', { cache: 'no-store' }).then(r => r.json());
        setRows((chats.chats ?? []).map((c: any) => ({ chatId: c.chat_id, chatName: c.chat_name ?? c.chat_id, channelId: c.discord_channel_id ?? '', isActive: c.is_active })));
      } catch (_) { setRows([]); }

      try {
        const avail = await fetch('/api/whatsapp/available-chats', { cache: 'no-store' }).then(r => r.json());
        setAvailableChats((avail.chats ?? []).map((c: any) => ({ chat_id: c.chat_id, chat_name: c.chat_name })));
      } catch (_) { setAvailableChats([]); }
    })();
  }, []);

  const columnHelper = createColumnHelper<Mapping>();
  const columns = useMemo(() => [
    columnHelper.display({
      id: 'chatName',
      header: 'Chat Name',
      cell: ({ row }) => {
        const btnRef = useRef<HTMLButtonElement | null>(null);
        // If there are no available chats, render a disabled control with guidance
        if (availableChats.length === 0) {
          return (
            <div className="inline-flex flex-col gap-1">
              <button disabled className="rounded border px-3 py-2 w-64 text-left bg-gray-100 text-gray-500 cursor-not-allowed">No chats available</button>
              <span className="text-xs text-gray-500">Receive a WhatsApp message, then refresh.</span>
            </div>
          );
        }
        return (
          <div className="relative inline-block">
            <Listbox value={row.original.chatId} onChange={(v) => updateChat(row.index, v)}>
              {({ open }) => {
                const rect = btnRef.current?.getBoundingClientRect();
                let style: any = undefined;
                if (rect) {
                  const minWidth = 288;
                  const width = Math.max(rect.width, minWidth);
                  let left = rect.left + window.scrollX;
                  if (left + width > window.innerWidth) left = Math.max(8, window.innerWidth - width - 8);
                  const maxBelow = window.innerHeight - rect.bottom - 8;
                  const maxAbove = rect.top - 8;
                  const desiredMaxH = 240;
                  let top = rect.bottom + window.scrollY;
                  let maxHeight = Math.min(desiredMaxH, maxBelow);
                  if (maxHeight < 120 && maxAbove > maxBelow) {
                    maxHeight = Math.min(desiredMaxH, maxAbove);
                    top = rect.top + window.scrollY - maxHeight;
                  }
                  style = { position: 'fixed' as const, top, left, width, zIndex: 2147483647, maxHeight };
                }
                return (
                  <>
                    <Listbox.Button ref={btnRef} className="rounded border px-3 py-2 w-64 text-left">
                      {row.original.chatName || 'Select a chat'}
                    </Listbox.Button>
                    {open && rect && (
                      <Portal>
                        <div className="headless-portal" aria-label="dropdown-portal" style={style}>
                          <Listbox.Options static className="w-full overflow-auto rounded border bg-white shadow" style={{ maxHeight: (style as any)?.maxHeight ?? 240 }}>
                            {availableChats.map(c => (
                              <Listbox.Option key={c.chat_id} value={c.chat_id} className="px-3 py-2 ui-active:bg-indigo-50 cursor-pointer">
                                {c.chat_name}
                              </Listbox.Option>
                            ))}
                          </Listbox.Options>
                        </div>
                      </Portal>
                    )}
                  </>
                );
              }}
            </Listbox>
          </div>
        );
      }
    }),
    columnHelper.display({
      id: 'channel',
      header: 'Discord Channel',
      cell: ({ row }) => (
        <div className="relative inline-block">
          <ChannelSelectCell value={row.original.channelId ?? ''} onChange={(v) => updateRow(row.index, v)} />
        </div>
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
  ], [channels, availableChats]);

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  function ChannelSelectCell(props: { value?: string; onChange: (v: string) => void }) {
    const btnRef = useRef<HTMLButtonElement | null>(null);
    if (channels.length === 0) {
      return (
        <div className="inline-flex flex-col gap-1">
          <button disabled className="rounded border px-3 py-2 w-64 text-left bg-gray-100 text-gray-500 cursor-not-allowed">No channels available</button>
          <span className="text-xs text-gray-500">Configure Discord in Admin → Test Connection to load channels.</span>
        </div>
      );
    }
    return (
      <Listbox value={props.value ?? ''} onChange={props.onChange}>
        {({ open }) => {
          const rect = btnRef.current?.getBoundingClientRect();
          let style: any = undefined;
          if (rect) {
            const minWidth = 288;
            const width = Math.max(rect.width, minWidth);
            let left = rect.left + window.scrollX;
            if (left + width > window.innerWidth) left = Math.max(8, window.innerWidth - width - 8);
            const maxBelow = window.innerHeight - rect.bottom - 8;
            const maxAbove = rect.top - 8;
            const desiredMaxH = 240;
            let top = rect.bottom + window.scrollY;
            let maxHeight = Math.min(desiredMaxH, maxBelow);
            if (maxHeight < 120 && maxAbove > maxBelow) {
              maxHeight = Math.min(desiredMaxH, maxAbove);
              top = rect.top + window.scrollY - maxHeight;
            }
            style = { position: 'fixed' as const, top, left, width, zIndex: 2147483647, maxHeight };
          }
          return (
            <>
              <Listbox.Button ref={btnRef} className="rounded border px-3 py-2 w-64 text-left">
                {channels.find(c => c.id === (props.value ?? ''))?.name ?? 'Select a channel'}
              </Listbox.Button>
              {open && rect && (
                <Portal>
                  <div className="headless-portal" aria-label="dropdown-portal" style={style}>
                    <Listbox.Options static className="w-full overflow-auto rounded border bg-white shadow" style={{ maxHeight: (style as any)?.maxHeight ?? 240 }}>
                      {channels.map(c => (
                        <Listbox.Option key={c.id} value={c.id} className="px-3 py-2 ui-active:bg-indigo-50 cursor-pointer">
                          {c.name}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                </Portal>
              )}
            </>
          );
        }}
      </Listbox>
    );
  }

  function addRow() {
    setRows(prev => [...prev, { chatId: '', chatName: 'New Mapping', channelId: '', isActive: true }]);
  }
  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, channelId: string) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, channelId }) : r));
  }
  function updateActive(index: number, active: boolean) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, isActive: active }) : r));
  }
  function updateChat(index: number, chatId: string) {
    const found = availableChats.find(c => c.chat_id === chatId);
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, chatId, chatName: found?.chat_name ?? chatId }) : r));
  }

  const [toasts, setToasts] = useState<Array<{ id: number; kind: 'success' | 'error'; message: string }>>([]);
  function addToast(message: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  async function save() {
    setPending(true);
    try {
      // Feature flags handled in Admin; only save mappings here
      const chatsPayload = { chats: rows.filter(r => r.chatId).map(r => ({ chat_id: r.chatId, discord_channel_id: r.channelId || null, is_active: r.isActive ?? true, chat_name: r.chatName || null })) };
      const res2 = await fetch('/api/whatsapp/chats', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatsPayload) });
      if (!res2.ok) throw new Error('Failed to save chats');
      addToast('WhatsApp mappings saved', 'success');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {toasts.length > 0 && (
        <div className="fixed right-4 top-4 z-50 space-y-2">
          {toasts.map(t => (
            <div key={t.id} className={`rounded px-4 py-2 text-white shadow ${t.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}
      {/* Feature toggles moved to Admin page */}

      <div className="rounded border bg-white p-4 shadow-sm" style={{ overflow: 'visible', position: 'relative' }}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Conversation / Channel Mapping</h3>
          <button onClick={addRow} className="rounded bg-indigo-600 px-3 py-2 text-white">Add Mapping</button>
        </div>

        <div className="rounded border" style={{ overflow: 'visible' }}>
          <table className="min-w-full text-sm" style={{ overflow: 'visible' }}>
            <thead className="bg-gray-50" style={{ overflow: 'visible' }}>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} style={{ overflow: 'visible' }}>{hg.headers.map(h => (
                  <th key={h.id} className="px-4 py-2 text-left font-medium text-gray-700" style={{ overflow: 'visible' }}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}</tr>
              ))}
            </thead>
            <tbody style={{ overflow: 'visible' }}>
              {table.getRowModel().rows.map(r => (
                <tr key={r.id} className="border-t" style={{ overflow: 'visible' }}>
                  {r.getVisibleCells().map(c => (
                    <td key={c.id} className="px-4 py-2 overflow-visible relative" style={{ overflow: 'visible' }}>
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


