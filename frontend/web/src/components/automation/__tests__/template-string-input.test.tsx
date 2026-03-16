import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateStringInput } from '../template-string-input';
import type { EventField } from '@/types/api.types';

const FIELDS: EventField[] = [
  { name: 'name',  type: 'string' },
  { name: 'email', type: 'string' },
];

describe('TemplateStringInput', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders an input with the given aria-label', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        aria-label="Body"
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    expect(screen.getByRole('textbox', { name: /body/i })).toBeInTheDocument();
  });

  it('shows {} button when eventFields is non-empty', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    expect(screen.getByRole('button', { name: /insert variable/i })).toBeInTheDocument();
  });

  it('hides {} button when eventFields is empty', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={[]}
        objectKey="customer"
      />,
    );
    expect(screen.queryByRole('button', { name: /insert variable/i })).not.toBeInTheDocument();
  });

  // ── Popover open / close ───────────────────────────────────────────────────

  it('opens the picker popover when {} button is clicked', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    // VariablePickerPopover renders a dialog
    expect(screen.getByRole('dialog', { name: /insert variable/i })).toBeInTheDocument();
  });

  it('closes popover when Escape is pressed on the input', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes popover when Escape is pressed on the {} button', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    fireEvent.keyDown(screen.getByRole('button', { name: /insert variable/i }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // ── Variable insertion ─────────────────────────────────────────────────────

  it('calls onChange with variable appended when selectionStart is null (jsdom default for unfocused input)', () => {
    // jsdom returns null for selectionStart on an input that has never been focused
    const onChange = vi.fn();
    render(
      <TemplateStringInput
        value="hello "
        onChange={onChange}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }));
    fireEvent.click(screen.getByRole('button', { name: 'name' }));
    expect(onChange).toHaveBeenCalledWith('hello {{customer.name}}');
  });

  it('propagates typed changes via onChange', () => {
    const onChange = vi.fn();
    render(
      <TemplateStringInput
        value=""
        onChange={onChange}
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('passes placeholder to the input', () => {
    render(
      <TemplateStringInput
        value=""
        onChange={vi.fn()}
        placeholder='{"name": "…"}'
        eventFields={FIELDS}
        objectKey="customer"
      />,
    );
    expect(screen.getByPlaceholderText('{"name": "…"}')).toBeInTheDocument();
  });
});
