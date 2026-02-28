import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricsCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: 'up' | 'down' | 'neutral';
  icon: LucideIcon;
  iconColor?: string;
}

export function MetricsCard({
  label,
  value,
  delta,
  deltaDirection = 'neutral',
  icon: Icon,
  iconColor = 'text-primary',
}: MetricsCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
          {delta && (
            <p
              className={cn(
                'mt-1 text-xs font-medium',
                deltaDirection === 'up' && 'text-green-600',
                deltaDirection === 'down' && 'text-red-600',
                deltaDirection === 'neutral' && 'text-muted-foreground',
              )}
            >
              {delta}
            </p>
          )}
        </div>
        <div className={cn('rounded-lg bg-primary/10 p-2.5', iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
