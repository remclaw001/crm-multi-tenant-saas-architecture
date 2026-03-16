'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { TemplateStringInput } from './template-string-input';
import type { ActionDefinition, StoredAction, EventField } from '@/types/api.types';

interface Props {
  actions:     StoredAction[];
  onChange:    (actions: StoredAction[]) => void;
  eventType:   string;
  eventFields: EventField[];
}

function makeEmptyParams(def: ActionDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of def.params) {
    params[p.name] = p.type === 'enum' && p.options?.length ? p.options[0].value : '';
  }
  return params;
}

export function ActionsStep({ actions, onChange, eventType, eventFields }: Props) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['automation-actions', tenantId],
    queryFn: () => crmApi.getAvailableActions(ctx),
  });

  const catalog: ActionDefinition[] = data?.data ?? [];
  const objectKey = eventType.split('.')[0];

  function addAction(def: ActionDefinition) {
    onChange([...actions, { type: def.type, params: makeEmptyParams(def) }]);
  }

  function removeAction(index: number) {
    onChange(actions.filter((_, i) => i !== index));
  }

  function updateParam(index: number, paramName: string, value: string) {
    onChange(
      actions.map((a, i) =>
        i === index ? { ...a, params: { ...a.params, [paramName]: value } } : a,
      ),
    );
  }

  const unusedDefs = catalog.filter((def) => !actions.some((a) => a.type === def.type));

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading actions…</p>;
  }

  if (isError) {
    return <p className="text-sm text-red-500">Failed to load actions catalog.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">
        Actions{' '}
        <span className="font-normal text-muted-foreground">
          (optional — runs when trigger fires)
        </span>
      </p>

      {/* Configured actions */}
      {actions.map((action, index) => {
        const def = catalog.find((d) => d.type === action.type);
        if (!def) return null;
        return (
          <div key={`${action.type}-${index}`} className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{def.label}</span>
              <button
                type="button"
                aria-label={`Remove ${def.label} action`}
                onClick={() => removeAction(index)}
                className="text-red-500 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {def.params.map((paramDef) => (
              <div key={paramDef.name}>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {paramDef.label}
                  {paramDef.required && <span className="ml-0.5 text-red-500">*</span>}
                </label>
                {paramDef.type === 'enum' ? (
                  <select
                    aria-label={paramDef.label}
                    value={(action.params[paramDef.name] as string) ?? ''}
                    onChange={(e) => updateParam(index, paramDef.name, e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {paramDef.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : paramDef.type === 'template-string' ? (
                  <TemplateStringInput
                    aria-label={paramDef.label}
                    value={(action.params[paramDef.name] as string) ?? ''}
                    onChange={(val) => updateParam(index, paramDef.name, val)}
                    placeholder={paramDef.hint ?? ''}
                    eventFields={eventFields}
                    objectKey={objectKey}
                  />
                ) : (
                  <input
                    aria-label={paramDef.label}
                    type="text"
                    value={(action.params[paramDef.name] as string) ?? ''}
                    onChange={(e) => updateParam(index, paramDef.name, e.target.value)}
                    placeholder={paramDef.hint ?? ''}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}

      {/* Add action dropdown */}
      {unusedDefs.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Add action:</p>
          <div className="flex flex-wrap gap-2">
            {unusedDefs.map((def) => (
              <button
                key={def.type}
                type="button"
                onClick={() => addAction(def)}
                className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
              >
                + {def.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {catalog.length === 0 && (
        <p className="text-sm text-muted-foreground">No actions available for your enabled plugins.</p>
      )}
    </div>
  );
}
