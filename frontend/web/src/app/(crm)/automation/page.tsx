'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { TriggersList } from '@/components/triggers-list';
import { PluginGate } from '@/components/plugin-gate';

export default function AutomationPage() {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['triggers', tenantId],
    queryFn: () => crmApi.getTriggers(ctx),
    enabled: Boolean(token && tenantId),
  });

  return (
    <PluginGate plugin="automation" pluginLabel="Automation">
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Automation</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.count} triggers` : 'Manage automation triggers'}
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load triggers.
          </div>
        ) : (
          <TriggersList triggers={data?.data ?? []} />
        )}
      </div>
    </PluginGate>
  );
}
