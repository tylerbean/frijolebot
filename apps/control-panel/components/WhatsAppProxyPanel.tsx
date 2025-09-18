'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Switch, Listbox } from '@headlessui/react';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';
import { useDiscordChannels, useWhatsAppChats, useWhatsAppAvailableChats } from '../hooks/useApi';

type Channel = { id: string; name: string };
type WAChat = { chat_id: string; chat_name: string };
type Mapping = { chatId: string; chatName: string; channelId?: string; isActive?: boolean };

export default function WhatsAppProxyPanel() {
  const [rows, setRows] = useState<Mapping[]>([]);
  const [pending, setPending] = useState(false);

  // Use SWR hooks for data fetching with caching
  const { channels, isLoading: channelsLoading } = useDiscordChannels();
  const { chats, isLoading: chatsLoading, mutate: mutateChats } = useWhatsAppChats();
  const { chats: availableChats, isLoading: availableChatsLoading } = useWhatsAppAvailableChats();

  const isLoading = channelsLoading || chatsLoading || availableChatsLoading;

  // Stable ref to avoid re-renders
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Update rows when chats data changes
  useEffect(() => {
    if (!chatsLoading && chats) {
      setRows(chats.map((c: any) => ({
        chatId: c.chat_id,
        chatName: c.chat_name ?? c.chat_id,
        channelId: c.discord_channel_id ?? '',
        isActive: c.is_active
      })));
    }
  }, [chats, chatsLoading]);

  const columnHelper = createColumnHelper<Mapping>();
  const columns = useMemo(() => [
    columnHelper.display({
      id: 'chatName',
      header: 'Chat Name',
      cell: ({ row }) => {
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
              <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">
                {row.original.chatName || 'Select a chat'}
              </Listbox.Button>
              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-64 overflow-auto rounded border bg-white shadow">
                {availableChats
                  .sort((a: WAChat, b: WAChat) => a.chat_name.localeCompare(b.chat_name))
                  .map((c: WAChat) => {
                  // Check if this chat is already selected in any other row using ref
                  const isAlreadySelected = rowsRef.current.some((r, i) => i !== row.index && r.chatId === c.chat_id);
                  return (
                    <Listbox.Option
                      key={c.chat_id}
                      value={c.chat_id}
                      disabled={isAlreadySelected}
                      className={`px-3 py-2 cursor-pointer ${isAlreadySelected ? 'text-gray-400 bg-gray-50 cursor-not-allowed' : 'ui-active:bg-indigo-50'}`}
                    >
                      {c.chat_name} {isAlreadySelected ? '(already selected)' : ''}
                    </Listbox.Option>
                  );
                })}
              </Listbox.Options>
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
          <ChannelSelectCell value={row.original.channelId ?? ''} onChange={(v) => updateRow(row.index, v)} rowIndex={row.index} />
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

  function ChannelSelectCell(props: { value?: string; onChange: (v: string) => void; rowIndex: number }) {
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
        <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">
          {channels.find((c: Channel) => c.id === (props.value ?? ''))?.name ?? 'Select a channel'}
        </Listbox.Button>
        <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-64 overflow-auto rounded border bg-white shadow">
          {channels
            .sort((a: Channel, b: Channel) => a.name.localeCompare(b.name))
            .map((c: Channel) => {
            // Check if this channel is already selected in any other row using ref
            const isAlreadySelected = rowsRef.current.some((r, i) => i !== props.rowIndex && r.channelId === c.id);
            return (
              <Listbox.Option
                key={c.id}
                value={c.id}
                disabled={isAlreadySelected}
                className={`px-3 py-2 cursor-pointer ${isAlreadySelected ? 'text-gray-400 bg-gray-50 cursor-not-allowed' : 'ui-active:bg-indigo-50'}`}
              >
                {c.name} {isAlreadySelected ? '(already selected)' : ''}
              </Listbox.Option>
            );
          })}
        </Listbox.Options>
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
    const found = availableChats.find((c: WAChat) => c.chat_id === chatId);
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

      // Revalidate the cache after successful save
      mutateChats();

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
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading chats and channels...</div>
          </div>
        )}
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


