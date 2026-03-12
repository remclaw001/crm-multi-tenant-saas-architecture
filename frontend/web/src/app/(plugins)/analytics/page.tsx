'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { AnalyticsSummaryView } from '@/components/analytics-summary';
import { PluginGate } from '@/components/plugin-gate';

export default function AnalyticsPage() {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data: summaryRes, isLoading: loadingSummary } = useQuery({
    queryKey: ['analytics-summary', tenantId],
    queryFn: () => crmApi.getAnalyticsSummary(ctx),
    enabled: Boolean(token && tenantId),
  });

  const { data: trendsRes, isLoading: loadingTrends } = useQuery({
    queryKey: ['analytics-trends', tenantId],
    queryFn: () => crmApi.getAnalyticsTrends(ctx),
    enabled: Boolean(token && tenantId),
  });

  const isLoading = loadingSummary || loadingTrends;

  return (
    <PluginGate plugin="analytics" pluginLabel="Analytics">
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Overview of your CRM data</p>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : summaryRes ? (
          <AnalyticsSummaryView
            summary={summaryRes.data}
            trends={Array.isArray(trendsRes?.data) ? trendsRes.data : []}
          />
        ) : null}
      </div>
    </PluginGate>
  );
}
