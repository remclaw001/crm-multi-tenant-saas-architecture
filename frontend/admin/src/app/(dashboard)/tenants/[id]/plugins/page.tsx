'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { adminApi } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { PluginToggle } from '@/components/plugin-toggle';

export default function TenantPluginsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const token = useAuthStore((s) => s.token ?? '');

  const { data: plugins, isLoading } = useQuery({
    queryKey: ['tenants', id, 'plugins'],
    queryFn: () => adminApi.getTenantPlugins(id, token),
    enabled: Boolean(token),
  });

  return (
    <div>
      <Link
        href={`/dashboard/tenants/${id}`}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tenant
      </Link>

      <h1 className="mb-6 text-xl font-semibold text-foreground">Plugin Management</h1>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          Loading plugins...
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(plugins ?? []).map((plugin) => (
            <PluginToggle key={plugin.id} tenantId={id} plugin={plugin} />
          ))}
          {plugins?.length === 0 && (
            <p className="col-span-2 text-center text-sm text-muted-foreground">
              No plugins available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
