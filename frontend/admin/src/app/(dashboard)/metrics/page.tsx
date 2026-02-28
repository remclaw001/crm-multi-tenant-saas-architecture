'use client';

import { useQuery } from '@tanstack/react-query';
import { Users, Activity, Clock, AlertTriangle, Database, Layers } from 'lucide-react';
import { adminApi } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { MetricsCard } from '@/components/metrics-card';
import { formatMs, formatPercent } from '@/lib/utils';

export default function MetricsPage() {
  const token = useAuthStore((s) => s.token ?? '');

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['metrics', 'summary'],
    queryFn: () => adminApi.getMetrics(token),
    refetchInterval: 15_000, // poll every 15 s
    enabled: Boolean(token),
  });

  const lastUpdated = dataUpdatedAt
    ? new Intl.DateTimeFormat('en-US', { timeStyle: 'medium' }).format(new Date(dataUpdatedAt))
    : null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Metrics</h1>
          {lastUpdated && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Last updated {lastUpdated} · Refreshes every 15 s
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading metrics...
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricsCard
            label="Active Tenants"
            value={String(data?.activeTenantsCount ?? 0)}
            icon={Users}
            iconColor="text-indigo-600"
          />
          <MetricsCard
            label="Requests / min"
            value={String(data?.requestsPerMinute ?? 0)}
            icon={Activity}
            iconColor="text-blue-600"
          />
          <MetricsCard
            label="Avg Response Time"
            value={formatMs(data?.avgResponseTimeMs ?? 0)}
            icon={Clock}
            iconColor="text-cyan-600"
            deltaDirection={(data?.avgResponseTimeMs ?? 0) > 500 ? 'down' : 'up'}
          />
          <MetricsCard
            label="Error Rate"
            value={formatPercent(data?.errorRate ?? 0)}
            icon={AlertTriangle}
            iconColor="text-red-600"
            deltaDirection={(data?.errorRate ?? 0) > 1 ? 'down' : 'up'}
          />
          <MetricsCard
            label="DB Pool Utilization"
            value={formatPercent(data?.dbPoolUtilization ?? 0)}
            icon={Database}
            iconColor="text-orange-600"
          />
          <MetricsCard
            label="Cache Hit Rate"
            value={formatPercent(data?.cacheHitRate ?? 0)}
            icon={Layers}
            iconColor="text-green-600"
            deltaDirection="up"
          />
        </div>
      )}
    </div>
  );
}
