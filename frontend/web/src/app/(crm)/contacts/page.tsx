'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useContactStore } from '@/stores/contact.store';
import { crmApi } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'customer', label: 'Customer' },
  { value: 'churned', label: 'Churned' },
];

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const { searchQuery, statusFilter, setSearchQuery, setStatusFilter } = useContactStore();

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['contacts', { search: searchQuery, status: statusFilter }],
    queryFn: () =>
      crmApi.getContacts(
        { search: searchQuery || undefined, status: statusFilter || undefined },
        ctx,
      ),
    enabled: Boolean(token && tenantId),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {data ? `${data.total} contacts` : 'Manage your contacts'}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter(e.target.value || null)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      ) : isError ? (
        <div className="flex h-64 items-center justify-center text-red-600">
          Failed to load contacts.
        </div>
      ) : (
        <ContactsList contacts={data?.data ?? []} />
      )}
    </div>
  );
}
