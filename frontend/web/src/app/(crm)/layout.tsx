'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users, Briefcase, CheckSquare } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

const PLUGIN_PAGES = [
  { plugin: 'customer-data', label: 'Contacts', href: '/contacts', icon: Users },
  { plugin: 'customer-care', label: 'Deals', href: '/deals', icon: Briefcase },
  { plugin: 'automation', label: 'Tasks', href: '/tasks', icon: CheckSquare },
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const { token, tenantId } = useAuthStore();
  const pathname = usePathname();

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['enabled-plugins', tenantId],
    queryFn: () => crmApi.getEnabledPlugins(ctx),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(token && tenantId),
  });

  const enabledPlugins = data?.enabledPlugins ?? [];
  const visibleNav = isLoading
    ? []
    : PLUGIN_PAGES.filter((p) => enabledPlugins.includes(p.plugin));

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-screen w-52 flex-shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center border-b border-border px-4 font-semibold">
          CRM
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {isLoading ? (
            <div className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-9 animate-pulse rounded-md bg-muted"
                />
              ))}
            </div>
          ) : (
            visibleNav.map(({ label, href, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })
          )}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
