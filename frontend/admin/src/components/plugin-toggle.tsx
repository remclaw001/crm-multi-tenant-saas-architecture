'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { adminApi, ApiError } from '@/lib/api-client';
import type { Plugin } from '@/types/api.types';
import { cn } from '@/lib/utils';

interface PluginToggleProps {
  tenantId: string;
  plugin: Plugin;
}

export function PluginToggle({ tenantId, plugin }: PluginToggleProps) {
  const token = useAuthStore((s) => s.token ?? '');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      adminApi.togglePlugin(tenantId, plugin.id, enabled, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants', tenantId, 'plugins'] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['tenants', tenantId, 'plugins'] });
    },
  });

  const errorMessage = mutation.error instanceof ApiError ? mutation.error.message : null;

  const isEnabled = plugin.enabled;

  return (
    <div
      className={cn(
        'rounded-lg border border-border p-4 transition-colors',
        isEnabled ? 'bg-primary/5' : 'bg-card',
        errorMessage ? 'border-destructive/50' : '',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 pr-4">
          <p className="text-sm font-medium text-foreground">{plugin.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">v{plugin.version}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {plugin.permissions.map((perm) => (
              <span
                key={perm}
                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {perm}
              </span>
            ))}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {plugin.limits.timeoutMs}ms · {plugin.limits.memoryMb}MB · {plugin.limits.maxQueriesPerRequest}q
          </div>
        </div>

        {/* Custom switch */}
        <button
          role="switch"
          aria-checked={isEnabled}
          aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${plugin.name}`}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(!isEnabled)}
          className={cn(
            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isEnabled ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'mt-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
              isEnabled ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {errorMessage && (
        <p className="mt-2 text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  );
}
