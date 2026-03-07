'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Building2, Plug } from 'lucide-react';
import { adminApi } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { formatDate, cn } from '@/lib/utils';

const PLAN_BADGE: Record<string, string> = {
  standard: 'bg-blue-100 text-blue-700',
  vip: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  trial: 'bg-yellow-100 text-yellow-700',
};

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const token = useAuthStore((s) => s.token ?? '');

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenants', id],
    queryFn: () => adminApi.getTenant(id, token),
    enabled: Boolean(token),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!tenant) return null;

  return (
    <div>
      <Link
        href="/tenants"
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tenants
      </Link>

      <div className="mb-6 flex items-start gap-4">
        <div className="rounded-xl bg-primary/10 p-3">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">{tenant.subdomain}.app.com</p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Plan</p>
          <span
            className={cn(
              'mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium',
              PLAN_BADGE[tenant.plan],
            )}
          >
            {tenant.plan}
          </span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Status</p>
          <span
            className={cn(
              'mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium',
              STATUS_BADGE[tenant.status],
            )}
          >
            {tenant.status}
          </span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Plugins</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{tenant.pluginCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Created</p>
          <p className="mt-1 text-sm font-medium">{formatDate(tenant.createdAt)}</p>
        </div>
      </div>

      <Link
        href={`/tenants/${id}/plugins`}
        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
      >
        <Plug className="h-5 w-5 text-primary" />
        <div>
          <p className="font-medium">Manage Plugins</p>
          <p className="text-sm text-muted-foreground">Enable or disable plugins for this tenant</p>
        </div>
      </Link>
    </div>
  );
}
