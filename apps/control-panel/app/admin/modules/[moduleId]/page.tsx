'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type Module = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  dependencies: string[];
  configSchema: any;
  defaultConfig: any;
  enabled: boolean;
  currentConfig: any;
  enabledBy: string | null;
  enabledAt: string | null;
  disabledAt: string | null;
};

type ModuleHealth = {
  status: 'healthy' | 'unhealthy' | 'disabled' | 'not_found' | 'error';
  details: any;
};

export default function ModuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const moduleId = params.moduleId as string;

  const [module, setModule] = useState<Module | null>(null);
  const [health, setHealth] = useState<ModuleHealth | null>(null);
  const [config, setConfig] = useState<any>({});
  const [guildId, setGuildId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; kind: 'success' | 'error'; message: string }>>([]);

  function addToast(message: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  // Fetch guild ID from settings
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { cache: 'no-store' });
        const data = await res.json();
        if (data.discord?.guildId) {
          setGuildId(data.discord.guildId);
        }
      } catch (error) {
        console.error('Error fetching guild ID:', error);
        addToast('Failed to load guild settings', 'error');
      }
    })();
  }, []);

  // Fetch module details when guild ID is available
  useEffect(() => {
    if (!guildId || !moduleId) return;

    (async () => {
      try {
        // Fetch module info
        const modulesRes = await fetch(`/api/modules?guildId=${guildId}`, { cache: 'no-store' });
        if (!modulesRes.ok) throw new Error('Failed to fetch modules');

        const modulesData = await modulesRes.json();
        const foundModule = modulesData.modules.find((m: Module) => m.id === moduleId);

        if (!foundModule) {
          addToast('Module not found', 'error');
          setLoading(false);
          return;
        }

        setModule(foundModule);
        setConfig(foundModule.currentConfig || foundModule.defaultConfig || {});

        // Fetch health status
        const healthRes = await fetch(`/api/modules/${moduleId}/health?guildId=${guildId}`, { cache: 'no-store' });
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          setHealth(healthData);
        }

        setLoading(false);
      } catch (error: any) {
        console.error('Error fetching module:', error);
        addToast(error.message || 'Failed to load module', 'error');
        setLoading(false);
      }
    })();
  }, [guildId, moduleId]);

  async function saveConfig() {
    if (!module || !guildId) return;

    setSaving(true);
    try {
      const endpoint = `/api/modules/${moduleId}/enable`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, config })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Save failed');
      }

      addToast('Configuration saved successfully', 'success');

      // Refresh module data
      const modulesRes = await fetch(`/api/modules?guildId=${guildId}`, { cache: 'no-store' });
      if (modulesRes.ok) {
        const modulesData = await modulesRes.json();
        const updatedModule = modulesData.modules.find((m: Module) => m.id === moduleId);
        if (updatedModule) {
          setModule(updatedModule);
        }
      }

    } catch (error: any) {
      console.error('Error saving config:', error);
      addToast(error.message || 'Failed to save configuration', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleModule() {
    if (!module || !guildId) return;

    setSaving(true);
    try {
      const endpoint = module.enabled
        ? `/api/modules/${moduleId}/disable`
        : `/api/modules/${moduleId}/enable`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, config: module.enabled ? undefined : config })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Toggle failed');
      }

      addToast(`Module ${module.enabled ? 'disabled' : 'enabled'} successfully`, 'success');

      // Refresh module data
      const modulesRes = await fetch(`/api/modules?guildId=${guildId}`, { cache: 'no-store' });
      if (modulesRes.ok) {
        const modulesData = await modulesRes.json();
        const updatedModule = modulesData.modules.find((m: Module) => m.id === moduleId);
        if (updatedModule) {
          setModule(updatedModule);
        }
      }

      // Refresh health
      const healthRes = await fetch(`/api/modules/${moduleId}/health?guildId=${guildId}`, { cache: 'no-store' });
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealth(healthData);
      }

    } catch (error: any) {
      console.error('Error toggling module:', error);
      addToast(error.message || 'Failed to toggle module', 'error');
    } finally {
      setSaving(false);
    }
  }

  function getStatusBadge() {
    if (!health) return null;

    switch (health.status) {
      case 'healthy':
        return <span className="px-3 py-1 text-sm rounded-full bg-green-100 text-green-800">● Healthy</span>;
      case 'unhealthy':
        return <span className="px-3 py-1 text-sm rounded-full bg-yellow-100 text-yellow-800">● Unhealthy</span>;
      case 'disabled':
        return <span className="px-3 py-1 text-sm rounded-full bg-gray-200 text-gray-700">○ Disabled</span>;
      case 'error':
        return <span className="px-3 py-1 text-sm rounded-full bg-red-100 text-red-800">✕ Error</span>;
      default:
        return null;
    }
  }

  function renderConfigForm() {
    if (!module) return null;

    // If no config schema, show raw JSON editor
    if (!module.configSchema || Object.keys(module.configSchema).length === 0) {
      return (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Configuration (JSON)
          </label>
          <textarea
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                setConfig(parsed);
              } catch {
                // Invalid JSON, ignore
              }
            }}
            className="w-full h-64 p-3 border border-gray-300 rounded font-mono text-sm"
            placeholder="{}"
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter valid JSON configuration
          </p>
        </div>
      );
    }

    // Render form fields based on schema
    return (
      <div className="space-y-4">
        {Object.entries(module.configSchema).map(([key, schema]: [string, any]) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {schema.label || key}
            </label>

            {schema.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={config[key] || false}
                onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
              />
            ) : schema.type === 'number' ? (
              <input
                type="number"
                value={config[key] || schema.default || 0}
                onChange={(e) => setConfig({ ...config, [key]: parseInt(e.target.value, 10) })}
                className="w-full p-2 border border-gray-300 rounded"
              />
            ) : (
              <input
                type="text"
                value={config[key] || schema.default || ''}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded"
                placeholder={schema.placeholder}
              />
            )}

            {schema.description && (
              <p className="text-xs text-gray-500 mt-1">{schema.description}</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p>Loading module details...</p>
      </main>
    );
  }

  if (!module) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-3xl font-bold mb-6">Module Not Found</h1>
        <Link href="/admin/modules" className="text-blue-600 hover:underline">
          ← Back to Modules
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded shadow-lg ${
              toast.kind === 'error' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      <div className="mb-6">
        <Link href="/admin/modules" className="text-blue-600 hover:underline text-sm">
          ← Back to Modules
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{module.name}</h1>
              {getStatusBadge()}
            </div>
            {module.version && (
              <p className="text-sm text-gray-500">Version: {module.version}</p>
            )}
          </div>

          <button
            onClick={toggleModule}
            disabled={saving}
            className={`px-4 py-2 rounded font-medium ${
              module.enabled
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            } disabled:opacity-50`}
          >
            {module.enabled ? 'Disable Module' : 'Enable Module'}
          </button>
        </div>

        <p className="text-gray-600 mb-4">{module.description || 'No description provided.'}</p>

        {module.dependencies && module.dependencies.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
            <p className="text-sm font-medium text-blue-900">Dependencies:</p>
            <p className="text-sm text-blue-800">{module.dependencies.join(', ')}</p>
          </div>
        )}

        {health?.status === 'unhealthy' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
            <p className="text-sm font-medium text-yellow-900">Health Warning:</p>
            <p className="text-sm text-yellow-800">
              {health.details.reason || 'Module is unhealthy'}
            </p>
            {health.details.missingDependencies && (
              <p className="text-sm text-yellow-800 mt-1">
                Missing dependencies: {health.details.missingDependencies.join(', ')}
              </p>
            )}
          </div>
        )}

        {module.enabled && module.enabledAt && (
          <p className="text-sm text-gray-500">
            Enabled: {new Date(module.enabledAt).toLocaleString()}
            {module.enabledBy && ` by ${module.enabledBy}`}
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Configuration</h2>

        {renderConfigForm()}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => router.push('/admin/modules')}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={saveConfig}
            disabled={saving || !module.enabled}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>

        {!module.enabled && (
          <p className="text-sm text-gray-500 mt-2">
            Enable the module to save configuration changes.
          </p>
        )}
      </div>
    </main>
  );
}
