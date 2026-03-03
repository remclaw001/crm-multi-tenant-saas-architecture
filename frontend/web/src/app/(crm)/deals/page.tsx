'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { DealsList } from '@/components/deals-list';
import { PluginGate } from '@/components/plugin-gate';
import type { Deal } from '@/types/api.types';

const STAGES: { value: Deal['stage'] | ''; label: string }[] = [
  { value: '', label: 'All stages' },
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export default function DealsPage() {
  const { token, tenantId } = useAuthStore();
  const [stageFilter, setStageFilter] = useState<string>('');

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['deals', { stage: stageFilter }],
    queryFn: () => crmApi.getDeals({ stage: stageFilter || undefined }, ctx),
    enabled: Boolean(token && tenantId),
  });

  const totalValue = data?.data.reduce((sum, d) => sum + d.value, 0) ?? 0;

  return (
    <PluginGate plugin="customer-care" pluginLabel="Customer Care">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Deals</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.total} deals · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalValue)} pipeline` : 'Track your pipeline'}
            </p>
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading...
          </div>
        ) : (
          <DealsList deals={data?.data ?? []} />
        )}
      </div>
    </PluginGate>
  );
}
