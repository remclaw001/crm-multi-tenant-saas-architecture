'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldOff } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

interface PluginGateProps {
  plugin: string;
  pluginLabel: string;
  children: React.ReactNode;
}

export function PluginGate({ plugin, pluginLabel, children }: PluginGateProps) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['enabled-plugins', tenantId],
    queryFn: () => crmApi.getEnabledPlugins(ctx),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(token && tenantId),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    );
  }

  const enabled = data?.enabledPlugins.includes(plugin) ?? false;

  if (!enabled) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <ShieldOff className="h-10 w-10 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold">{pluginLabel} plugin not enabled</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This feature is unavailable for your account.
            <br />
            Contact your administrator to enable the{' '}
            <span className="font-medium">{pluginLabel}</span> plugin.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
