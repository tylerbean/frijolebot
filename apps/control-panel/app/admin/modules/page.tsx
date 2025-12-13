'use client';
import { useEffect, useState } from 'react';
import { Switch } from '@headlessui/react';
import Link from 'next/link';

type Module = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  dependencies: string[];
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

export default function ModulesPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [healthStatus, setHealthStatus] = useState<Record<string, ModuleHealth>>({});
  const [loading, setLoading] = useState(true);
  const [guildId, setGuildId] = useState<string>('');
  const [toasts, setToasts] = useState<Array<{ id: number; kind: 'success' | 'error'; message: string }>>([]);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);

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

  // Fetch modules when guild ID is available
  useEffect(() => {
    if (!guildId) return;

    (async () => {
      try {
        const res = await fetch(`/api/modules?guildId=${guildId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch modules');

        const data = await res.json();
        setModules(data.modules || []);
        setLoading(false);

        // Fetch health status for each module
        for (const module of data.modules || []) {
          fetchModuleHealth(module.id);
        }
      } catch (error: any) {
        console.error('Error fetching modules:', error);
        addToast(error.message || 'Failed to load modules', 'error');
        setLoading(false);
      }
    })();
  }, [guildId]);

  async function fetchModuleHealth(moduleId: string) {
    try {
      const res = await fetch(`/api/modules/${moduleId}/health?guildId=${guildId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch health');

      const data = await res.json();
      setHealthStatus(prev => ({ ...prev, [moduleId]: data }));
    } catch (error) {
      console.error(`Error fetching health for ${moduleId}:`, error);
    }
  }

  async function toggleModule(module: Module) {
    if (togglingModule) return; // Prevent concurrent toggles

    setTogglingModule(module.id);

    try {
      const endpoint = module.enabled
        ? `/api/modules/${module.id}/disable`
        : `/api/modules/${module.id}/enable`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Toggle failed');
      }

      const data = await res.json();

      // Update local state
      setModules(prev => prev.map(m =>
        m.id === module.id ? { ...m, enabled: !module.enabled } : m
      ));

      addToast(`Module ${module.enabled ? 'disabled' : 'enabled'}: ${module.name}`, 'success');

      // Refresh health status
      await fetchModuleHealth(module.id);

    } catch (error: any) {
      console.error('Error toggling module:', error);
      addToast(error.message || 'Failed to toggle module', 'error');
    } finally {
      setTogglingModule(null);
    }
  }

  function getStatusBadge(moduleId: string) {
    const health = healthStatus[moduleId];
    if (!health) return <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700">Loading...</span>;

    switch (health.status) {
      case 'healthy':
        return <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800">● Healthy</span>;
      case 'unhealthy':
        return <span className="px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800">● Unhealthy</span>;
      case 'disabled':
        return <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700">○ Disabled</span>;
      case 'error':
        return <span className="px-2 py-1 text-xs rounded bg-red-100 text-red-800">✕ Error</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded bg-gray-200 text-gray-700">Unknown</span>;
    }
  }

  function getDependencyInfo(module: Module) {
    if (!module.dependencies || module.dependencies.length === 0) {
      return null;
    }

    const depModules = module.dependencies.map(depId =>
      modules.find(m => m.id === depId)
    );

    const missingDeps = module.dependencies.filter(depId => {
      const depModule = modules.find(m => m.id === depId);
      return !depModule || !depModule.enabled;
    });

    if (missingDeps.length > 0) {
      return (
        <div className="mt-2 text-xs text-yellow-600">
          ⚠️ Missing dependencies: {missingDeps.join(', ')}
        </div>
      );
    }

    return (
      <div className="mt-2 text-xs text-gray-500">
        Depends on: {module.dependencies.join(', ')}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <h1 className="text-3xl font-bold mb-6">Module Management</h1>
        <p>Loading modules...</p>
      </main>
    );
  }

  if (!guildId) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <h1 className="text-3xl font-bold mb-6">Module Management</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
          <p className="text-yellow-800">
            No guild ID configured. Please configure Discord settings first.
          </p>
          <Link href="/admin" className="text-blue-600 hover:underline mt-2 inline-block">
            Go to Discord Settings →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
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

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Module Management</h1>
        <Link href="/admin" className="text-blue-600 hover:underline">
          ← Back to Admin
        </Link>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
        <h2 className="font-semibold text-blue-900">About Modules</h2>
        <p className="text-sm text-blue-800 mt-1">
          Enable or disable feature modules for your Discord server. Changes take effect immediately without requiring a restart.
        </p>
      </div>

      {modules.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded p-8 text-center">
          <p className="text-gray-600">No modules available.</p>
          <p className="text-sm text-gray-500 mt-2">
            Modules will appear here once they are installed in the modules/ directory.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {modules.map((module) => (
            <div
              key={module.id}
              className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-semibold">{module.name}</h3>
                    {getStatusBadge(module.id)}
                    {module.version && (
                      <span className="text-xs text-gray-500">v{module.version}</span>
                    )}
                  </div>

                  <p className="text-gray-600 mt-2">{module.description || 'No description provided.'}</p>

                  {getDependencyInfo(module)}

                  {module.enabled && module.enabledAt && (
                    <p className="text-xs text-gray-500 mt-2">
                      Enabled: {new Date(module.enabledAt).toLocaleString()}
                      {module.enabledBy && ` by ${module.enabledBy}`}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4 ml-6">
                  <Switch
                    checked={module.enabled}
                    onChange={() => toggleModule(module)}
                    disabled={togglingModule === module.id}
                    className={`${
                      module.enabled ? 'bg-blue-600' : 'bg-gray-300'
                    } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50`}
                  >
                    <span
                      className={`${
                        module.enabled ? 'translate-x-6' : 'translate-x-1'
                      } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                    />
                  </Switch>

                  <Link
                    href={`/admin/modules/${module.id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Configure →
                  </Link>
                </div>
              </div>

              {healthStatus[module.id]?.status === 'unhealthy' && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded p-3">
                  <p className="text-sm text-yellow-800">
                    {healthStatus[module.id].details.reason || 'Module is unhealthy'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
