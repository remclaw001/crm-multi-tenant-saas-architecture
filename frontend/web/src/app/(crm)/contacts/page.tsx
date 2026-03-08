'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';
import { AddContactModal } from '@/components/add-contact-modal';
import { PluginGate } from '@/components/plugin-gate';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => crmApi.getCustomers(ctx),
    enabled: Boolean(token && tenantId),
  });

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['customers', tenantId] });
  }

  return (
    <PluginGate plugin="customer-data" pluginLabel="Customer Data">
      <div>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Contacts</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.count} contacts` : 'Manage your contacts'}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Contact
          </button>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load contacts.
          </div>
        ) : (
          <ContactsList contacts={data?.data ?? []} />
        )}

        <AddContactModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      </div>
    </PluginGate>
  );
}
