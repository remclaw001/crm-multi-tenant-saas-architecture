'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { crmApi } from '@/lib/api-client';
import { ActionsStep } from '@/components/automation/actions-step';
import type { AutomationTrigger, StoredAction } from '@/types/api.types';

// ── Constants ──────────────────────────────────────────────────────────────────

const EVENT_TYPES = ['customer.create'];
const ATTRIBUTES = ['name', 'email', 'phone', 'company'];
const OPERATORS = [
  { value: 'equals',       label: 'equals',       needsValue: true },
  { value: 'not_equals',   label: 'not equals',   needsValue: true },
  { value: 'contains',     label: 'contains',     needsValue: true },
  { value: 'starts_with',  label: 'starts with',  needsValue: true },
  { value: 'is_empty',     label: 'is empty',     needsValue: false },
  { value: 'is_not_empty', label: 'is not empty', needsValue: false },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface ConditionRow {
  id: string;
  field: string;
  op: string;
  value: string;
}

interface FormState {
  name: string;
  eventType: string;
  isActive: boolean;
  conditions: ConditionRow[];
  actions: StoredAction[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  trigger?: AutomationTrigger; // when set → edit mode
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRow(): ConditionRow {
  return { id: crypto.randomUUID(), field: ATTRIBUTES[0], op: OPERATORS[0].value, value: '' };
}

function operatorNeedsValue(op: string): boolean {
  return OPERATORS.find((o) => o.value === op)?.needsValue ?? true;
}

function conditionsToRows(conditions: Record<string, unknown>): ConditionRow[] {
  const and = (conditions as { and?: { field: string; op: string; value?: string }[] }).and;
  if (!and) return [];
  return and.map((c) => ({
    id: crypto.randomUUID(),
    field: c.field ?? ATTRIBUTES[0],
    op: c.op ?? OPERATORS[0].value,
    value: c.value ?? '',
  }));
}

function triggerToForm(t: AutomationTrigger): FormState {
  return {
    name: t.name,
    eventType: t.event_type,
    isActive: t.is_active,
    conditions: conditionsToRows(t.conditions),
    actions: t.actions,
  };
}

const EMPTY_FORM: FormState = {
  name: '',
  eventType: EVENT_TYPES[0],
  isActive: true,
  conditions: [],
  actions: [],
};

// ── Component ──────────────────────────────────────────────────────────────────

export function CreateTriggerModal({ open, onClose, onSuccess, trigger }: Props) {
  const { token, tenantId } = useAuthStore();
  const ctx = { token: token ?? '', tenantId: tenantId ?? '' };
  const isEdit = Boolean(trigger);

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [conditionErrors, setConditionErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');

  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof crmApi.createTrigger>[0]) =>
      crmApi.createTrigger(input, ctx),
  });

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof crmApi.updateTrigger>[1]) =>
      crmApi.updateTrigger(trigger!.id, input, ctx),
  });

  const mutation = isEdit ? updateMutation : createMutation;

  // Sync form when modal opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setForm(trigger ? triggerToForm(trigger) : EMPTY_FORM);
      setConditionErrors({});
      setApiError('');
      createMutation.reset();
      updateMutation.reset();
    }
  }, [open, trigger?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function handleClose() {
    setStep(1);
    setForm(EMPTY_FORM);
    setConditionErrors({});
    setApiError('');
    createMutation.reset();
    updateMutation.reset();
    onClose();
  }

  function addCondition() {
    setForm((prev) => ({ ...prev, conditions: [...prev.conditions, makeRow()] }));
  }

  function removeCondition(id: string) {
    setForm((prev) => ({ ...prev, conditions: prev.conditions.filter((r) => r.id !== id) }));
    setConditionErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateCondition(id: string, patch: Partial<Omit<ConditionRow, 'id'>>) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    if (patch.value !== undefined || patch.op !== undefined) {
      setConditionErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  function validateConditions(): boolean {
    const errors: Record<string, string> = {};
    for (const row of form.conditions) {
      if (operatorNeedsValue(row.op) && !row.value.trim()) {
        errors[row.id] = 'Value is required';
      }
    }
    setConditionErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setApiError('');

    const payload = {
      name: form.name.trim(),
      event_type: form.eventType,
      is_active: form.isActive,
      conditions:
        form.conditions.length > 0
          ? { and: form.conditions.map((r) => ({ field: r.field, op: r.op, value: r.value })) }
          : {},
      actions: form.actions,
    };

    try {
      await mutation.mutateAsync(payload);
      setForm(EMPTY_FORM);
      onSuccess();
      onClose();
    } catch {
      setApiError(`Failed to ${isEdit ? 'update' : 'create'} trigger. Please try again.`);
    }
  }

  // ── Step indicator ─────────────────────────────────────────────────────────
  const StepIndicator = (
    <div className="flex items-center gap-2 mb-5">
      {([1, 2, 3] as const).map((s, i) => (
        <>
          {i > 0 && (
            <div
              key={`line-${s}`}
              className={`h-0.5 flex-1 ${step > s - 1 ? 'bg-green-500' : 'bg-border'}`}
            />
          )}
          <div
            key={`step-${s}`}
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              step === s
                ? 'bg-primary text-primary-foreground'
                : step > s
                ? 'bg-green-500 text-white'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {step > s ? '✓' : s}
          </div>
        </>
      ))}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit Automation Trigger' : 'New Automation Trigger'}
        className="w-full max-w-md rounded-lg bg-card shadow-xl border border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold">
            {isEdit ? 'Edit Trigger' : 'New Automation Trigger'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {StepIndicator}

          {/* ── Step 1 ─────────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="trigger-name" className="mb-1.5 block text-sm font-medium">
                  Trigger Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="trigger-name"
                  aria-label="Trigger Name"
                  type="text"
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Welcome new enterprise customer"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label htmlFor="trigger-event" className="mb-1.5 block text-sm font-medium">
                  Event Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="trigger-event"
                  aria-label="Event Type"
                  value={form.eventType}
                  onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {EVENT_TYPES.map((et) => (
                    <option key={et} value={et}>{et}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Active</span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Active"
                  aria-checked={form.isActive}
                  onClick={() => setForm((prev) => ({ ...prev, isActive: !prev.isActive }))}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                    form.isActive ? 'bg-green-500' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      form.isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className={`text-sm ${form.isActive ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {form.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          )}

          {/* ── Step 2 ─────────────────────────────────────────────────────── */}
          {step === 2 && (
            <div>
              <p className="mb-3 text-sm font-medium">
                Conditions{' '}
                <span className="font-normal text-muted-foreground">(optional — leave empty to fire on every event)</span>
              </p>

              {form.conditions.map((row, idx) => (
                <div key={row.id}>
                  {idx > 0 && (
                    <div className="my-2 text-center">
                      <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        AND
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <div className="flex flex-1 gap-2">
                      <select
                        aria-label="Attribute"
                        value={row.field}
                        onChange={(e) => updateCondition(row.id, { field: e.target.value })}
                        className="flex-[2] rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {ATTRIBUTES.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>

                      <select
                        aria-label="Operator"
                        value={row.op}
                        onChange={(e) => updateCondition(row.id, { op: e.target.value, value: '' })}
                        className="flex-[2] rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                      {operatorNeedsValue(row.op) && (
                        <div className="flex-[3]">
                          <input
                            aria-label="Value"
                            type="text"
                            value={row.value}
                            onChange={(e) => updateCondition(row.id, { value: e.target.value })}
                            placeholder="Value…"
                            aria-describedby={conditionErrors[row.id] ? `condition-error-${row.id}` : undefined}
                            className={`w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                              conditionErrors[row.id] ? 'border-red-500' : 'border-border'
                            }`}
                          />
                          {conditionErrors[row.id] && (
                            <p id={`condition-error-${row.id}`} className="mt-0.5 text-xs text-red-500">{conditionErrors[row.id]}</p>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      aria-label="Remove condition"
                      onClick={() => removeCondition(row.id)}
                      className="mt-1.5 text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addCondition}
                className="mt-3 flex items-center gap-1 text-sm text-primary hover:underline"
              >
                + Add condition
              </button>
            </div>
          )}

          {/* ── Step 3 ─────────────────────────────────────────────────────── */}
          {step === 3 && (
            <ActionsStep
              actions={form.actions}
              onChange={(actions) => setForm((prev) => ({ ...prev, actions }))}
            />
          )}

          {apiError && (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{apiError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-border px-6 py-4">
          {step === 1 ? (
            <>
              <div />
              <button
                type="button"
                disabled={!form.name.trim()}
                onClick={() => setStep(2)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Next →
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => { if (validateConditions()) setStep(3); }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Next →
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={handleSubmit}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {mutation.isPending
                  ? (isEdit ? 'Saving…' : 'Creating…')
                  : (isEdit ? 'Save Changes' : 'Create Trigger')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
