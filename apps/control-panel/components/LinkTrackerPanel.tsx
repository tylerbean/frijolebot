'use client';
import { useEffect, useMemo, useState } from 'react';
import { Switch, Listbox } from '@headlessui/react';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';
import { useDiscordChannels, useDiscordMonitoredChannels, useAdminSettings } from '../hooks/useApi';

type Channel = { id: string; name: string };
type RowData = { key?: string; name: string; id: string; isActive?: boolean };
type Monitored = { guild_id: string; channel_id: string; channel_name?: string; is_active?: boolean };

export default function LinkTrackerPanel() {
  const [rows, setRows] = useState<RowData[]>([]);
  const [pending, setPending] = useState(false);

  // Use SWR hooks for data fetching with caching
  const { channels, isLoading: channelsLoading } = useDiscordChannels();
  const { channels: monitoredChannels, isLoading: monitoredLoading, mutate: mutateMonitored } = useDiscordMonitoredChannels();
  const { settings, isLoading: settingsLoading } = useAdminSettings();

  const enabled = settings?.discord?.enabled || false;
  const isLoading = channelsLoading || monitoredLoading || settingsLoading;

  // Debug logging (removed from render - was causing infinite loop)

  // Update rows when monitored channels data changes, with name hydration from channels
  useEffect(() => {
    if (!monitoredLoading && monitoredChannels) {
      const mapped: RowData[] = monitoredChannels.map((m: Monitored) => ({
        key: `${m.guild_id}:${m.channel_id}`,
        id: m.channel_id,
        name: (channels.length > 0 ? channels.find((c: Channel) => c.id === m.channel_id)?.name : null) || m.channel_name || m.channel_id,
        isActive: m.is_active !== false
      }));
      setRows(mapped);
    }
  }, [monitoredChannels, monitoredLoading, channels]);

  const columnHelper = createColumnHelper<RowData>();
  const columns = useMemo(() => [
    columnHelper.display({
      id: 'name',
      header: 'Channel',
      cell: ({ row }) => (
        <div className="relative inline-block">
          <Listbox value={row.original.id} onChange={(v) => updateRow(row.index, v)}>
            <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">
              {channelsLoading ? 'Loading...' : channels.find((c: Channel) => c.id === row.original.id)?.name ?? 'Select a channel'}
            </Listbox.Button>
            <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-64 overflow-auto rounded border bg-white shadow">
              {channelsLoading ? (
                <div className="px-3 py-2 text-gray-500">Loading channels...</div>
              ) : channels.map((c: Channel) => {
                // Check if this channel is already monitored by another row
                const isAlreadyMonitored = rows.some(r => r.id === c.id && r.id !== row.original.id && r.isActive);
                return (
                  <Listbox.Option
                    key={c.id}
                    value={c.id}
                    disabled={isAlreadyMonitored}
                    className={`px-3 py-2 cursor-pointer ${isAlreadyMonitored ? 'text-gray-400 bg-gray-50 cursor-not-allowed' : 'ui-active:bg-indigo-50'}`}
                  >
                    {c.name} {isAlreadyMonitored ? '(already monitored)' : ''}
                  </Listbox.Option>
                );
              })}
            </Listbox.Options>
          </Listbox>
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
  ], [channels, channelsLoading]);

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  function addRow() {
    setRows(prev => [...prev, { key: '', id: '', name: 'Select a channel', isActive: true }]);
  }
  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }
  function updateRow(index: number, id: string) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, id, name: channels.find((c: Channel) => c.id === id)?.name ?? id }) : r));
  }
  function updateActive(index: number, active: boolean) {
    setRows(prev => prev.map((r, i) => i === index ? ({ ...r, isActive: active }) : r));
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
      // Only save rows that have valid channel IDs (filters out empty/new rows without selections)
      const toSave = rows
        .filter(r => r.id && r.id.trim() !== '')
        .map(r => ({
          channel_id: r.id,
          channel_name: channels.find((c: Channel) => c.id === r.id)?.name || r.name,
          is_active: r.isActive ?? true
        }));

      const res = await fetch('/api/discord/monitored-channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: toSave })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save monitored channels');
      }

      // Revalidate the cache after successful save
      await mutateMonitored();

      addToast('Monitored channels saved', 'success');
    } catch (error: any) {
      console.error('Save error:', error);
      addToast(error.message || 'Failed to save monitored channels', 'error');
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
      {/* Feature toggle moved to Admin page */}

      <div className="rounded border bg-white p-4 shadow-sm">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading channels...</div>
          </div>
        )}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Monitored Channels</h3>
          <button
            onClick={addRow}
            disabled={channelsLoading}
            className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
        <div className="rounded border" style={{ overflow: 'visible' }}>
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


