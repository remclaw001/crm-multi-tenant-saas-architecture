'use client';

import type { Campaign } from '@/types/api.types';

const STATUS_STYLE: Record<Campaign['status'], string> = {
  draft:     'bg-slate-100 text-slate-600',
  active:    'bg-green-100 text-green-700',
  paused:    'bg-amber-100 text-amber-700',
  completed: 'bg-sky-100 text-sky-700',
};

const TYPE_LABEL: Record<Campaign['campaign_type'], string> = {
  email: 'Email',
  sms:   'SMS',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CampaignsList({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No campaigns found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {campaigns.map((c) => (
        <div key={c.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.name}</p>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{TYPE_LABEL[c.campaign_type]}</span>
                <span>·</span>
                <span>Scheduled: {formatDate(c.scheduled_at)}</span>
              </div>
              {(c.target_count > 0 || c.sent_count > 0) && (
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Target: {c.target_count.toLocaleString()}</span>
                  <span>·</span>
                  <span>Sent: {c.sent_count.toLocaleString()}</span>
                </div>
              )}
            </div>
            <span
              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[c.status]}`}
            >
              {c.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
