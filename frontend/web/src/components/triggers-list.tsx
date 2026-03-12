'use client';

import type { AutomationTrigger } from '@/types/api.types';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TriggersList({ triggers, onEdit }: { triggers: AutomationTrigger[]; onEdit: (t: AutomationTrigger) => void }) {
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
            <span
              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                t.is_active
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t.is_active ? 'Active' : 'Inactive'}
            </span>
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
