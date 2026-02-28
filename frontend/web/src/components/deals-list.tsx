'use client';

// Exposed as Module Federation REMOTE module (see next.config.ts).
// import('web/DealsList') loads this component in the Admin Console
// or any authorised shell at runtime without a host rebuild.

import type { Deal } from '@/types/api.types';

const STAGE_ORDER: Deal['stage'][] = [
  'new', 'qualified', 'proposal', 'negotiation', 'won', 'lost',
];

const STAGE_COLOR: Record<Deal['stage'], string> = {
  new: 'bg-slate-100 text-slate-700',
  qualified: 'bg-blue-100 text-blue-700',
  proposal: 'bg-indigo-100 text-indigo-700',
  negotiation: 'bg-amber-100 text-amber-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};

interface DealsListProps {
  deals: Deal[];
  view?: 'list' | 'board';
}

// Board view groups deals by pipeline stage — matches how sales teams work.
function BoardView({ deals }: { deals: Deal[] }) {
  const grouped = STAGE_ORDER.reduce<Record<Deal['stage'], Deal[]>>(
    (acc, stage) => ({ ...acc, [stage]: [] }),
    {} as Record<Deal['stage'], Deal[]>,
  );
  deals.forEach((d) => grouped[d.stage].push(d));

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STAGE_ORDER.map((stage) => (
        <div key={stage} className="w-64 flex-shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLOR[stage]}`}>
              {stage}
            </span>
            <span className="text-xs text-muted-foreground">{grouped[stage].length}</span>
          </div>
          <div className="space-y-2">
            {grouped[stage].map((deal) => (
              <div key={deal.id} className="rounded-lg border border-border bg-card p-3">
                <p className="text-sm font-medium">{deal.title}</p>
                <p className="text-xs text-muted-foreground">{deal.contactName}</p>
                <p className="mt-1.5 text-sm font-semibold">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: deal.currency,
                    maximumFractionDigits: 0,
                  }).format(deal.value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListView({ deals }: { deals: Deal[] }) {
  return (
    <div className="space-y-2">
      {deals.map((deal) => (
        <div key={deal.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div>
            <p className="font-medium">{deal.title}</p>
            <p className="text-xs text-muted-foreground">{deal.contactName}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLOR[deal.stage]}`}>
              {deal.stage}
            </span>
            <span className="font-semibold tabular-nums">
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: deal.currency,
                maximumFractionDigits: 0,
              }).format(deal.value)}
            </span>
          </div>
        </div>
      ))}
      {deals.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No deals found.</p>
      )}
    </div>
  );
}

export function DealsList({ deals, view = 'board' }: DealsListProps) {
  return view === 'board' ? <BoardView deals={deals} /> : <ListView deals={deals} />;
}
