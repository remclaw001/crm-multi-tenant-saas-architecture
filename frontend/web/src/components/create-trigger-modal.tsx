'use client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateTriggerModal({ open, onClose, onSuccess: _onSuccess }: Props) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="New Automation Trigger">
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
