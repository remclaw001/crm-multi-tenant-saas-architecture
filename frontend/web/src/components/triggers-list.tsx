'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import type { AutomationTrigger } from '@/types/api.types';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TriggersList({
  triggers,
  onEdit,
  onToggled,
}: {
  triggers: AutomationTrigger[];
  onEdit: (t: AutomationTrigger) => void;
  onToggled: () => void;
}) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggle(t: AutomationTrigger) {
    if (togglingId) return;
    setTogglingId(t.id);
    try {
      await crmApi.updateTrigger(t.id, { is_active: !t.is_active }, ctx);
      onToggled();
    } finally {
      setTogglingId(null);
    }
  }

  if (triggers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No automation triggers found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {triggers.map((t) => (
        <div key={t.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onEdit(t)}
                className="text-sm font-medium text-left hover:underline hover:text-primary"
              >
                {t.name}
              </button>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Event: <span className="font-mono">{t.event_type}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleToggle(t)}
              disabled={togglingId === t.id}
              aria-label={t.is_active ? 'Deactivate trigger' : 'Activate trigger'}
              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium transition-opacity disabled:opacity-50 ${
                t.is_active
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {togglingId === t.id ? '…' : t.is_active ? 'Active' : 'Inactive'}
            </button>
          </div>
          {t.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {t.actions.map((a, i) => (
                <span
                  key={i}
                  className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {a.type}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Created {formatDate(t.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
