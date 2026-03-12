'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { TriggersList } from '@/components/triggers-list';
import { PluginGate } from '@/components/plugin-gate';
import { CreateTriggerModal } from '@/components/create-trigger-modal';
import type { AutomationTrigger } from '@/types/api.types';

export default function AutomationPage() {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<AutomationTrigger | undefined>();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['triggers', tenantId],
    queryFn: () => crmApi.getTriggers(ctx),
    enabled: Boolean(token && tenantId),
  });

  function openCreate() {
    setEditingTrigger(undefined);
    setModalOpen(true);
  }

  function openEdit(trigger: AutomationTrigger) {
    setEditingTrigger(trigger);
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    setEditingTrigger(undefined);
  }

  return (
    <PluginGate plugin="automation" pluginLabel="Automation">
      <div>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Automation</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} triggers` : 'Manage automation triggers'}
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Add Trigger
          </button>
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
          <TriggersList triggers={data?.data ?? []} onEdit={openEdit} />
        )}

        <CreateTriggerModal
          open={modalOpen}
          onClose={handleClose}
          onSuccess={() => { void refetch(); }}
          trigger={editingTrigger}
        />
      </div>
    </PluginGate>
  );
}
