'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CampaignsList } from '@/components/campaigns-list';
import { AddCampaignModal } from '@/components/add-campaign-modal';
import { PluginGate } from '@/components/plugin-gate';
import type { Campaign } from '@/types/api.types';

const STATUSES: { value: Campaign['status'] | ''; label: string }[] = [
  { value: '',          label: 'All statuses' },
  { value: 'draft',     label: 'Draft'        },
  { value: 'active',    label: 'Active'       },
  { value: 'paused',    label: 'Paused'       },
  { value: 'completed', label: 'Completed'    },
];

export default function MarketingPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaigns', tenantId],
    queryFn: () => crmApi.getCampaigns(ctx),
    enabled: Boolean(token && tenantId),
  });

  const filtered = statusFilter
    ? (data?.data ?? []).filter((c) => c.status === statusFilter)
    : (data?.data ?? []);

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['campaigns', tenantId] });
  }

  return (
    <PluginGate plugin="marketing" pluginLabel="Marketing">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Marketing</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} campaigns` : 'Manage marketing campaigns'}
            </p>
          </div>
          <div className="flex items-center gap-3">
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
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Add Campaign
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load campaigns.
          </div>
        ) : (
          <CampaignsList campaigns={filtered} />
        )}

        <AddCampaignModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      </div>
    </PluginGate>
  );
}
