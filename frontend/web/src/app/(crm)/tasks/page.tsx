'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { PluginGate } from '@/components/plugin-gate';
import type { Task } from '@/types/api.types';

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  low: 'text-slate-500',
  medium: 'text-amber-600',
  high: 'text-red-600',
};

function formatDue(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  return `Due in ${diffDays}d`;
}

export default function TasksPage() {
  const { token, tenantId } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState<string>('todo');
  const qc = useQueryClient();

  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', { status: statusFilter }],
    queryFn: () => crmApi.getTasks({ status: statusFilter || undefined }, ctx),
    enabled: Boolean(token && tenantId),
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: string) =>
      crmApi.updateTask(taskId, { status: 'done' }, ctx),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <PluginGate plugin="automation" pluginLabel="Automation">
      <div>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Tasks</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {data ? `${data.total} tasks` : 'Manage your tasks'}
            </p>
          </div>
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {(['todo', 'in_progress', 'done'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Loading...
          </div>
        ) : (
          <div className="space-y-2">
            {(data?.data ?? []).map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4"
              >
                <button
                  onClick={() => task.status !== 'done' && completeMutation.mutate(task.id)}
                  disabled={task.status === 'done' || completeMutation.isPending}
                  className="mt-0.5 flex-shrink-0 disabled:opacity-40"
                >
                  {task.status === 'done' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    <span className={PRIORITY_COLOR[task.priority]}>{task.priority}</span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDue(task.dueDate)}
                    </span>
                    {task.relatedTo && (
                      <span className="text-muted-foreground">
                        {task.relatedTo.type}: {task.relatedTo.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {data?.data.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No tasks found.</p>
            )}
          </div>
        )}
      </div>
    </PluginGate>
  );
}
