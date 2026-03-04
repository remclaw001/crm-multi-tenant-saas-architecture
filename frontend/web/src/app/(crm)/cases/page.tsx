'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CasesList } from '@/components/cases-list';
import { PluginGate } from '@/components/plugin-gate';
import type { SupportCase } from '@/types/api.types';

const STATUSES: { value: SupportCase['status'] | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export default function CasesPage() {
  const { token, tenantId } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['cases'],
    queryFn: () => crmApi.getCases(ctx),
    enabled: Boolean(token && tenantId),
  });

  const filtered = statusFilter
    ? (data?.data ?? []).filter((c) => c.status === statusFilter)
    : (data?.data ?? []);

  return (
    <PluginGate plugin="customer-care" pluginLabel="Customer Care">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Cases</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} support cases` : 'Manage support cases'}
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : (
          <CasesList cases={filtered} />
        )}
      </div>
    </PluginGate>
  );
}
