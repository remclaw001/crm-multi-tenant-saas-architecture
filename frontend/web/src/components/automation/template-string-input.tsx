'use client';

import { useState, useRef, useEffect } from 'react';
import { VariablePickerPopover } from './variable-picker-popover';
import type { EventField } from '@/types/api.types';

interface Props {
  value:         string;
  onChange:      (value: string) => void;
  placeholder?:  string;
  disabled?:     boolean;
  'aria-label'?: string;
  className?:    string;
  eventFields:   EventField[];
  objectKey:     string;
}

export function TemplateStringInput({
  value,
  onChange,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
  className,
  eventFields,
  objectKey,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef   = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Snapshot cursor position at the moment {} is clicked (before blur shifts focus)
  const selectionRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end:   null,
  });

  const hasFields = eventFields.length > 0;

  // Close on click outside the wrapper
  useEffect(() => {
    if (!pickerOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [pickerOpen]);

  function handlePickerButtonMouseDown(e: React.MouseEvent) {
    // Capture selectionStart BEFORE the input loses focus due to button click
    selectionRef.current = {
      start: inputRef.current?.selectionStart ?? null,
      end:   inputRef.current?.selectionEnd   ?? null,
    };
    // Prevent default so the input does NOT blur (keeps selection intact for capture)
    e.preventDefault();
  }

  function handlePickerButtonClick() {
    setPickerOpen((prev) => !prev);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && pickerOpen) {
      setPickerOpen(false);
      inputRef.current?.focus();
    }
  }

  function handleInsert(variable: string) {
    const { start, end } = selectionRef.current;
    let newValue: string;
    if (start === null) {
      // Fallback: append to end
      newValue = value + variable;
    } else {
      const s  = start;
      const e2 = end ?? s;
      newValue = value.slice(0, s) + variable + value.slice(e2);
    }
    onChange(newValue);
    setPickerOpen(false);
    // Restore focus and place cursor immediately after the inserted token
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newPos = (start ?? value.length) + variable.length;
        inputRef.current.setSelectionRange(newPos, newPos);
      }
    });
  }

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        style={hasFields ? { paddingRight: '2.25rem' } : undefined}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {hasFields && (
        <button
          type="button"
          aria-label="Insert variable"
          onMouseDown={handlePickerButtonMouseDown}
          onClick={handlePickerButtonClick}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-primary hover:text-primary-foreground"
        >
          {'{}'}
        </button>
      )}
      {pickerOpen && (
        <VariablePickerPopover
          fields={eventFields}
          objectKey={objectKey}
          onInsert={handleInsert}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
