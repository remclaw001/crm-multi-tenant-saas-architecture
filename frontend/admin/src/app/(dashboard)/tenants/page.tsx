'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Search, Plus } from 'lucide-react';
import { useState } from 'react';
import { adminApi } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { useTenantStore } from '@/stores/tenant.store';
import { TenantTable } from '@/components/tenant-table';
import { AddTenantModal } from '@/components/add-tenant-modal';

export default function TenantsPage() {
  const token = useAuthStore((s) => s.token ?? '');
  const { searchQuery, setSearchQuery } = useTenantStore();
  const router = useRouter();
  const [page] = useState(1);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tenants', { page, search: searchQuery }],
    queryFn: () => adminApi.getTenants({ page, limit: 20, search: searchQuery }, token),
    enabled: Boolean(token),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tenants</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.total} total tenants` : 'Manage all tenants'}
          </p>
        </div>
        <button
          onClick={() => setAddModalOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add tenant
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tenants..."
          className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">Loading...</div>
      ) : isError ? (
        <div className="flex h-64 items-center justify-center text-destructive">
          Failed to load tenants.
        </div>
      ) : (
        <TenantTable
          data={data?.data ?? []}
          globalFilter={searchQuery}
          onRowClick={(t) => router.push(`/tenants/${t.id}`)}
        />
      )}

      <AddTenantModal open={addModalOpen} onClose={() => setAddModalOpen(false)} />
    </div>
  );
}
