'use client';

import type { AnalyticsSummary, TrendPoint } from '@/types/api.types';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function AnalyticsSummaryView({
  summary,
  trends,
}: {
  summary: AnalyticsSummary;
  trends: TrendPoint[];
}) {
  const activeRate =
    summary.totalCustomers > 0
      ? Math.round((summary.activeCustomers / summary.totalCustomers) * 100)
      : 0;

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Customers" value={summary.totalCustomers} />
        <StatCard label="Active Customers" value={summary.activeCustomers} />
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Active Rate
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{activeRate}%</p>
        </div>
      </div>

      {/* Trends */}
      {trends.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold">New Customers — Daily Trend</h2>
          <div className="rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Date
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {trends.map((pt) => (
                  <tr
                    key={pt.date}
                    className="border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">{formatDate(pt.date)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{pt.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
