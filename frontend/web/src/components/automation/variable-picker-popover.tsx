'use client';

import type { EventField } from '@/types/api.types';

interface Props {
  fields:    EventField[];
  objectKey: string;
  onInsert:  (variable: string) => void;
  onClose:   () => void;
}

export function VariablePickerPopover({ fields, objectKey, onInsert, onClose }: Props) {
  function handleFieldClick(field: EventField) {
    onInsert(`{{${objectKey}.${field.name}}}`);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Insert variable"
      aria-modal={true}
      className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border border-border bg-card shadow-lg"
    >
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {objectKey}
      </div>
      <div className="grid grid-cols-2 gap-1 p-2">
        {fields.map((field) => (
          <button
            key={field.name}
            type="button"
            aria-label={field.name}
            onClick={() => handleFieldClick(field)}
            className="rounded p-2 text-left text-sm hover:bg-accent"
          >
            <div className="font-medium">{field.name}</div>
            <div className="text-xs text-muted-foreground">{field.type}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
