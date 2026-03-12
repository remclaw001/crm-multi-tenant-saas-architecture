'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { CasesList } from '@/components/cases-list';
import { CreateCaseModal } from '@/components/create-case-modal';
import { EditCaseModal } from '@/components/edit-case-modal';
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
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<SupportCase | null>(null);
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cases', tenantId],
    queryFn: () => crmApi.getCases(ctx),
    enabled: Boolean(token && tenantId),
  });

  const filtered = statusFilter
    ? (data?.data ?? []).filter((c) => c.status === statusFilter)
    : (data?.data ?? []);

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['cases', tenantId] });
  }

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
              New Case
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load cases.
          </div>
        ) : (
          <CasesList cases={filtered} onEdit={setEditingCase} />
        )}

        <CreateCaseModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />

        {editingCase && (
          <EditCaseModal
            supportCase={editingCase}
            onClose={() => setEditingCase(null)}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </PluginGate>
  );
}
