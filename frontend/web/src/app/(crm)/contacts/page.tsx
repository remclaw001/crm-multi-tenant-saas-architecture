'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';
import { PluginGate } from '@/components/plugin-gate';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', tenantId],
    queryFn: () => crmApi.getCustomers(ctx),
    enabled: Boolean(token && tenantId),
  });

  return (
    <PluginGate plugin="customer-data" pluginLabel="Customer Data">
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.count} contacts` : 'Manage your contacts'}
          </p>
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
      </div>
    </PluginGate>
  );
}
