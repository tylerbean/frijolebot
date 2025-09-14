'use client';
import { useEffect, useState, useRef } from 'react';
import { Switch, Listbox, Portal } from '@headlessui/react';

type Settings = {
  discord: { enabled: boolean; token?: string; tokenPreview?: string; tokenDecryptError?: boolean; guildId?: string; adminChannelId?: string; linkTrackerEnabled?: boolean };
  whatsapp: { enabled: boolean; storeMessages: boolean };
  timezone: { tz: string };
  caching: { redisUrl?: string; enabled?: boolean };
  rateLimit: { enabled: boolean; windowSec: number; maxRequests: number; cleanupIntervalSec: number };
};

export default function AdminPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [discordTest, setDiscordTest] = useState<string>('');
  const [redisTest, setRedisTest] = useState<string>('');
  const [discordChannels, setDiscordChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [toasts, setToasts] = useState<Array<{ id: number; kind: 'success' | 'error'; message: string }>>([]);

  function addToast(message: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  useEffect(() => {
    (async () => {
      const data = await fetch('/api/admin/settings', { cache: 'no-store' }).then(r => r.json());
      setS({
        discord: { enabled: false, ...data.discord },
        whatsapp: { enabled: false, storeMessages: false, ...data.whatsapp },
        timezone: { tz: 'UTC', ...data.timezone },
        caching: { ...data.caching },
        rateLimit: { enabled: true, windowSec: 60, maxRequests: 5, cleanupIntervalSec: 300, ...data.rateLimit }
      });
      setLoading(false);
    })();
  }, []);

  // Load channel list using server-side decrypted token if guildId is present
  useEffect(() => {
    (async () => {
      if (!s?.discord?.guildId) return;
      try {
        // Use GET endpoint that decrypts token at the server
        const res = await fetch('/api/discord/channels', { cache: 'no-store' }).then(r=>r.json());
        if (Array.isArray(res?.channels)) setDiscordChannels(res.channels);
      } catch {}
    })();
  }, [s?.discord?.guildId]);

  if (loading || !s) return <main className="mx-auto max-w-5xl p-6">Loading...</main>;

  async function saveDiscord() {
    try {
      if (!s) return;
      const payload: any = {
        enabled: !!s.discord.enabled,
        linkTrackerEnabled: s.discord.linkTrackerEnabled === undefined ? undefined : !!s.discord.linkTrackerEnabled,
      };
      if (s.discord.token && s.discord.token.trim().length >= 10) payload.token = s.discord.token.trim();
      if (s.discord.guildId && s.discord.guildId.trim().length > 0) payload.guildId = s.discord.guildId.trim();
      if (s.discord.adminChannelId && s.discord.adminChannelId.trim().length > 0) payload.adminChannelId = s.discord.adminChannelId.trim();
      const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discord: payload }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
      addToast('Discord settings saved', 'success');
    } catch (e: any) {
      addToast(`Discord save failed: ${e.message || e}`, 'error');
    }
  }
  async function saveWhatsApp() {
    try {
      if (!s) return;
      const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsapp: s.whatsapp }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
      addToast('WhatsApp settings saved', 'success');
    } catch (e: any) {
      addToast(`WhatsApp save failed: ${e.message || e}`, 'error');
    }
  }
  async function saveTimezone() {
    try {
      if (!s) return;
      const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: s.timezone }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
      addToast('Timezone saved', 'success');
    } catch (e: any) {
      addToast(`Timezone save failed: ${e.message || e}`, 'error');
    }
  }
  async function saveCaching() {
    try {
      if (!s) return;
      const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caching: s.caching }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
      const isEmpty = !s.caching.redisUrl || s.caching.redisUrl.trim() === '';
      addToast(isEmpty ? 'Caching disabled' : 'Caching settings saved', 'success');
      // Reflect server normalization locally: empty URL disables caching
      if (!s.caching.redisUrl || s.caching.redisUrl.trim() === '') {
        setS({ ...s, caching: { ...s.caching, enabled: false, redisUrl: '' } });
      }
      // Refresh test status: if URL empty, show disabled; else retest
      try {
        if (!s.caching.redisUrl || s.caching.redisUrl.trim() === '') {
          setRedisTest('');
        } else {
          const res = await fetch('/api/admin/test/redis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).then(r=>r.json());
          const err = res?.error || res?.code || 'Unknown error';
          setRedisTest(res.ok ? 'Redis OK' : `Failed: ${err}`);
        }
      } catch {}
    } catch (e: any) {
      addToast(`Caching save failed: ${e.message || e}`, 'error');
    }
  }
  async function saveRateLimit() {
    try {
      if (!s) return;
      const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rateLimit: s.rateLimit }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
      addToast('Rate limit settings saved', 'success');
    } catch (e: any) {
      addToast(`Rate limit save failed: ${e.message || e}`, 'error');
    }
  }

  async function testDiscord() {
    try {
      const res = await fetch('/api/admin/test/discord', { method: 'POST' }).then(r => r.json());
      setDiscordTest(res.ok ? `Connected to ${res.guild?.name || res.guild?.id}` : `Failed: ${res.error || res.status}`);
      addToast(res.ok ? 'Discord connected' : `Discord test failed: ${res.error || res.status}`, res.ok ? 'success' : 'error');
    } catch (e: any) {
      addToast(`Discord test failed: ${e.message || e}`, 'error');
    }
  }
  async function testRedis() {
    try {
      if (!s) return;
      const res = await fetch('/api/admin/test/redis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redisUrl: s.caching.redisUrl || '' }) }).then(r => r.json());
      const err = res?.error || res?.code || 'Unknown error';
      setRedisTest(res.ok ? 'Redis OK' : `Failed: ${err}`);
      addToast(res.ok ? 'Redis connected' : `Redis test failed: ${err}`, res.ok ? 'success' : 'error');
    } catch (e: any) {
      addToast(`Redis test failed: ${e.message || e}`, 'error');
    }
  }

  const tzList = ['UTC','America/Chicago','America/New_York','Europe/London','Europe/Berlin','Asia/Tokyo'];

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      {s.discord?.tokenDecryptError && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          Discord functionality is disabled: encrypted bot token could not be decrypted. Ensure CONFIG_CRYPTO_KEY matches the key used to store the token, then re-save the token.
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <a href="/" className="rounded border px-3 py-2 hover:bg-gray-50">Back</a>
      </div>

      <section className="rounded border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-medium">Discord</h2>
        <h3 className="text-sm font-medium text-gray-700">General</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-gray-700">Discord Bot Token</span>
            <input type="password" autoComplete="new-password" value={s.discord.token || ''} onChange={e=>setS({ ...s, discord: { ...s.discord, token: e.target.value }})} className="mt-1 w-full rounded border px-3 py-2" placeholder={s.discord.tokenPreview ? s.discord.tokenPreview : ''} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">Discord Guild ID</span>
            <input value={s.discord.guildId || ''} onChange={e=>setS({ ...s, discord: { ...s.discord, guildId: e.target.value }})} className="mt-1 w-full rounded border px-3 py-2" placeholder="" />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">Discord Admin Channel</span>
            {(() => {
              const disabled = !discordChannels || discordChannels.length === 0;
              const AdminChannelSelect = () => {
                const btnRef = useRef<HTMLButtonElement | null>(null);
                return (
                  <Listbox value={s.discord.adminChannelId || ''} onChange={(v:string)=>setS({ ...s, discord: { ...s.discord, adminChannelId: v }})}>
                    {({ open }) => {
                      const rect = btnRef.current?.getBoundingClientRect();
                      const style = rect ? { position: 'fixed' as const, top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width, zIndex: 2147483647 } : undefined;
                      return (
                        <>
                          <Listbox.Button ref={btnRef} className={`mt-1 w-full rounded border px-3 py-2 text-left ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`} aria-disabled={disabled}>
                            {s.discord.adminChannelId ? (discordChannels.find(c=>c.id===s.discord.adminChannelId)?.name || s.discord.adminChannelId) : (discordChannels.length ? 'Select a channel' : 'Select after connect test')}
                          </Listbox.Button>
                          {open && rect && !disabled && (
                            <Portal>
                              <div style={style}>
                                <Listbox.Options static className="max-h-60 w-full overflow-auto rounded border bg-white shadow">
                                  {discordChannels.map(c => (
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
              };
              return <AdminChannelSelect/>;
            })()}
          </label>
          <div className="flex items-end gap-2">
            <button onClick={async ()=>{
              try {
                const res = await fetch('/api/admin/test/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: s.discord.token, guildId: s.discord.guildId })}).then(r=>r.json());
                const guildName = res?.guild?.name || res?.guilds?.[0]?.name;
                setDiscordTest(res.ok ? (guildName ? `Connected to ${guildName}` : 'Connected') : `Failed: ${res.error || res.status}`);
                addToast(res.ok ? 'Discord connected' : `Discord test failed: ${res.error || res.status}`, res.ok ? 'success' : 'error');
                if (res.ok) {
                  // Reload channels from server-decrypted endpoint
                  const list = await fetch('/api/discord/channels', { cache: 'no-store' }).then(r=>r.json()).catch(()=>({ channels: [] }));
                  if (Array.isArray(list?.channels)) setDiscordChannels(list.channels);
                }
              } catch (e: any) {
                addToast(`Discord test failed: ${e.message || e}`, 'error');
              }
            }} className="rounded bg-indigo-600 px-3 py-2 text-white">Test Connection</button>
            <span className="text-sm text-gray-600">{discordTest}</span>
          </div>
        </div>
        <h3 className="text-sm font-medium text-gray-700 pt-2">Link Tracker</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Enable Discord Link Tracker</p>
          </div>
          <Switch checked={!!s.discord.enabled} onChange={(v)=>setS({ ...s, discord: { ...s.discord, enabled: v }})} className={`${s.discord.enabled ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full`}>
            <span className={`${s.discord.enabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
        <div className="pt-2">
          <button onClick={saveDiscord} className="rounded bg-green-600 px-3 py-2 text-white">Save</button>
        </div>
      </section>

      <section className="rounded border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-medium">WhatsApp</h2>
        <div className="flex items-center justify-between">
          <div><p className="text-sm text-gray-600">Enable WhatsApp Proxy</p></div>
          <Switch checked={!!s.whatsapp.enabled} onChange={(v)=>setS({ ...s, whatsapp: { ...s.whatsapp, enabled: v }})} className={`${s.whatsapp.enabled ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full`}>
            <span className={`${s.whatsapp.enabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
        <div className="flex items-center justify-between">
          <div><p className="text-sm text-gray-600">Store Messages</p></div>
          <Switch disabled={!s.whatsapp.enabled} checked={!!s.whatsapp.storeMessages} onChange={(v)=>setS({ ...s, whatsapp: { ...s.whatsapp, storeMessages: v }})} className={`${s.whatsapp.enabled ? (s.whatsapp.storeMessages ? 'bg-indigo-600' : 'bg-gray-300') : 'bg-gray-200'} relative inline-flex h-6 w-11 items-center rounded-full ${!s.whatsapp.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <span className={`${s.whatsapp.storeMessages ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
        <div>
          <button onClick={saveWhatsApp} className="rounded bg-green-600 px-3 py-2 text-white">Save</button>
        </div>
      </section>

      <section className="rounded border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-medium">Time Zone</h2>
        <Listbox value={s.timezone.tz} onChange={(v)=>setS({ ...s, timezone: { tz: v }})}>
          <Listbox.Button className="rounded border px-3 py-2 w-64 text-left">{s.timezone.tz}</Listbox.Button>
          <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-64 overflow-auto rounded border bg-white shadow">
            {tzList.map((tz) => (
              <Listbox.Option key={tz} value={tz} className="px-3 py-2 ui-active:bg-indigo-50 cursor-pointer">{tz}</Listbox.Option>
            ))}
          </Listbox.Options>
        </Listbox>
        <div>
          <button onClick={saveTimezone} className="rounded bg-green-600 px-3 py-2 text-white">Save</button>
        </div>
      </section>

      <section className="rounded border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-medium">Caching</h2>
        <div className="flex items-center justify-between">
          <div><p className="text-sm text-gray-600">Enabled</p></div>
          <Switch checked={!!s.caching.enabled} onChange={(v)=>setS({ ...s, caching: { ...s.caching, enabled: v }})} className={`${s.caching.enabled ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full`}>
            <span className={`${s.caching.enabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
        <label className="block">
          <span className="text-sm text-gray-700">Redis URL</span>
          <input value={s.caching.redisUrl || ''} onChange={e=>setS({ ...s, caching: { ...s.caching, redisUrl: e.target.value }})} className={`mt-1 w-full rounded border px-3 py-2`} placeholder="redis://host:6379/1" />
        </label>
        <div className="flex items-center gap-2">
          <button onClick={testRedis} className="rounded bg-indigo-600 px-3 py-2 text-white">Test Redis</button>
          <button onClick={saveCaching} className="rounded bg-green-600 px-3 py-2 text-white">Save</button>
          <span className="text-sm text-gray-600">{redisTest}</span>
        </div>
      </section>

      <section className="rounded border bg-white p-4 shadow-sm space-y-3">
        <h2 className="font-medium">Rate Limiting</h2>
        <div className="flex items-center justify-between">
          <div><p className="text-sm text-gray-600">Enabled</p></div>
          <Switch checked={!!s.rateLimit.enabled} onChange={(v)=>setS({ ...s, rateLimit: { ...s.rateLimit, enabled: v }})} className={`${s.rateLimit.enabled ? 'bg-indigo-600' : 'bg-gray-300'} relative inline-flex h-6 w-11 items-center rounded-full`}>
            <span className={`${s.rateLimit.enabled ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`} />
          </Switch>
        </div>
        <div className={`grid gap-3 sm:grid-cols-3 ${!s.rateLimit.enabled ? 'opacity-60' : ''}`}>
          <label className="block">
            <span className="text-sm text-gray-700">Window (sec)</span>
            <input disabled={!s.rateLimit.enabled} type="number" value={s.rateLimit.windowSec} onChange={e=>setS({ ...s, rateLimit: { ...s.rateLimit, windowSec: parseInt(e.target.value || '0', 10) }})} className={`mt-1 w-full rounded border px-3 py-2 ${!s.rateLimit.enabled ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">Max Requests</span>
            <input disabled={!s.rateLimit.enabled} type="number" value={s.rateLimit.maxRequests} onChange={e=>setS({ ...s, rateLimit: { ...s.rateLimit, maxRequests: parseInt(e.target.value || '0', 10) }})} className={`mt-1 w-full rounded border px-3 py-2 ${!s.rateLimit.enabled ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">Cleanup (sec)</span>
            <input disabled={!s.rateLimit.enabled} type="number" value={s.rateLimit.cleanupIntervalSec} onChange={e=>setS({ ...s, rateLimit: { ...s.rateLimit, cleanupIntervalSec: parseInt(e.target.value || '0', 10) }})} className={`mt-1 w-full rounded border px-3 py-2 ${!s.rateLimit.enabled ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
          </label>
        </div>
        <div>
          <button onClick={saveRateLimit} className="rounded bg-green-600 px-3 py-2 text-white">Save</button>
        </div>
      </section>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`min-w-[240px] rounded shadow-lg px-4 py-3 text-white transition-opacity duration-300 ${t.kind === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>{t.message}</div>
        ))}
      </div>
    </main>
  );
}


