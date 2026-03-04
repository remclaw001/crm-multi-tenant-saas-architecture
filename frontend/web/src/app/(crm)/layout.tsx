'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users, Headset, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';

const PLUGIN_PAGES = [
  { plugin: 'customer-data', label: 'Contacts', href: '/contacts', icon: Users },
  { plugin: 'customer-care', label: 'Cases', href: '/cases', icon: Headset },
];

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, tenantId, tenantName, userName, logout } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  // Auth guard — runs client-side after hydration
  useEffect(() => {
    if (!hydrated) return;
    if (!token || !tenantId) {
      router.replace('/login');
    }
  }, [hydrated, token, tenantId, router]);

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

  if (!hydrated || !token || !tenantId) {
    // Render nothing while the redirect is in-flight
    return null;
  }

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-screen w-52 flex-shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold">{tenantName ?? 'CRM'}</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {isLoading ? (
            <div className="space-y-1">
              {[1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
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

        <div className="border-t border-border p-3">
          <div className="mb-2 px-3 text-xs text-muted-foreground">{userName}</div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
