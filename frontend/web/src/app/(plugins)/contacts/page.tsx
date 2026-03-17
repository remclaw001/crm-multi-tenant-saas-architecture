'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { CustomerFilter } from '@/lib/api-client';
import { ContactsList } from '@/components/contacts-list';
import { AddContactModal } from '@/components/add-contact-modal';
import { EditContactModal } from '@/components/edit-contact-modal';
import { DeleteContactModal } from '@/components/delete-contact-modal';
import { PluginGate } from '@/components/plugin-gate';
import type { Customer } from '@/types/api.types';

export default function ContactsPage() {
  const { token, tenantId } = useAuthStore();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Customer | null>(null);
  const [deletingContact, setDeletingContact] = useState<Customer | null>(null);

  // Form state — what the user is currently typing (not yet submitted)
  const [filterForm, setFilterForm] = useState({
    name:    '',
    company: '',
    phone:   '',
    status:  'active' as 'active' | 'inactive' | 'all',
  });

  // Active filter — triggers the actual API call when changed
  const [activeFilter, setActiveFilter] = useState<CustomerFilter>({ status: 'active' });

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', tenantId, activeFilter],
    queryFn:  () => crmApi.getCustomers(ctx, activeFilter),
    enabled:  Boolean(token && tenantId),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { name, company, phone, status } = filterForm;
    setActiveFilter({
      status,
      ...(name.trim()    ? { name:    name.trim()    } : {}),
      ...(company.trim() ? { company: company.trim() } : {}),
      ...(phone.trim()   ? { phone:   phone.trim()   } : {}),
    });
  }

  function handleReset() {
    const defaults = { name: '', company: '', phone: '', status: 'active' as const };
    setFilterForm(defaults);
    setActiveFilter({ status: 'active' });
  }

  function handleSuccess() {
    queryClient.invalidateQueries({ queryKey: ['customers', tenantId] });
  }

  return (
    <PluginGate plugin="customer-data" pluginLabel="Customer Data">
      <div>
        {/* Page header */}
        <div className="mb-4 flex items-start justify-between">
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

        {/* Filter form */}
        <form
          aria-label="Contact filters"
          onSubmit={handleSubmit}
          className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <input
              id="filter-name"
              type="text"
              value={filterForm.name}
              onChange={(e) => setFilterForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Nguyen…"
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-company" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Company
            </label>
            <input
              id="filter-company"
              type="text"
              value={filterForm.company}
              onChange={(e) => setFilterForm((f) => ({ ...f, company: e.target.value }))}
              placeholder="e.g. Acme…"
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-phone" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Phone
            </label>
            <input
              id="filter-phone"
              type="text"
              value={filterForm.phone}
              onChange={(e) => setFilterForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="e.g. 0912…"
              className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="filter-status" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </label>
            <select
              id="filter-status"
              value={filterForm.status}
              onChange={(e) => {
                const status = e.target.value as 'active' | 'inactive' | 'all';
                // Merge current form (including unsaved text) + new status → submit immediately
                // Use closure value directly (not functional updater) to avoid double-call in React Strict Mode
                const updated = { ...filterForm, status };
                setFilterForm(updated);
                setActiveFilter(updated);
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              Reset
            </button>
          </div>
        </form>

        {/* Contacts table */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-red-600">
            Failed to load contacts.
          </div>
        ) : (
          <ContactsList
            contacts={data?.data ?? []}
            onEdit={setEditingContact}
            onDelete={setDeletingContact}
          />
        )}

        <AddContactModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />

        {editingContact && (
          <EditContactModal
            contact={editingContact}
            onClose={() => setEditingContact(null)}
            onSuccess={handleSuccess}
          />
        )}

        {deletingContact && (
          <DeleteContactModal
            contact={deletingContact}
            onClose={() => setDeletingContact(null)}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    </PluginGate>
  );
}
