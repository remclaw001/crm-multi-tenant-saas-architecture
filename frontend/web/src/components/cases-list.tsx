'use client';

import type { SupportCase } from '@/types/api.types';

const STATUS_STYLE: Record<SupportCase['status'], string> = {
  open: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
};

const PRIORITY_STYLE: Record<SupportCase['priority'], string> = {
  low: 'text-slate-500',
  medium: 'text-amber-600',
  high: 'text-red-600',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CasesList({
  cases,
  onEdit,
}: {
  cases: SupportCase[];
  onEdit: (c: SupportCase) => void;
}) {
  if (cases.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No cases found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {cases.map((c) => (
        <div
          key={c.id}
          onClick={() => onEdit(c)}
          className="cursor-pointer rounded-lg border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">{c.title}</p>
              {c.customer_name && (
                <p className="mt-0.5 text-xs text-muted-foreground">Customer: {c.customer_name}</p>
              )}
              {c.description && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{c.description}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>
                {c.status.replace('_', ' ')}
              </span>
              <span className={`text-xs font-medium ${PRIORITY_STYLE[c.priority]}`}>
                {c.priority}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
