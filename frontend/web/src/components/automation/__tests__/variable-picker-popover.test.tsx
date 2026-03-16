import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariablePickerPopover } from '../variable-picker-popover';

const FIELDS = [
  { name: 'name',    type: 'string' as const },
  { name: 'email',   type: 'string' as const },
  { name: 'phone',   type: 'string' as const },
];

describe('VariablePickerPopover', () => {
  it('renders all field names', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('phone')).toBeInTheDocument();
  });

  it('renders field types', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // each field shows its type; there are 3 "string" labels
    expect(screen.getAllByText('string')).toHaveLength(3);
  });

  it('renders objectKey as header label', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/customer/i)).toBeInTheDocument();
  });

  it('calls onInsert with correct variable string on field click', () => {
    const onInsert = vi.fn();
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={onInsert}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onInsert).toHaveBeenCalledWith('{{customer.name}}');
  });

  it('calls onClose after insert', () => {
    const onClose = vi.fn();
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /email/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('uses objectKey from props in inserted variable', () => {
    const onInsert = vi.fn();
    render(
      <VariablePickerPopover
        fields={[{ name: 'status', type: 'string' }]}
        objectKey="deal"
        onInsert={onInsert}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /status/i }));
    expect(onInsert).toHaveBeenCalledWith('{{deal.status}}');
  });

  it('does not render a back arrow (level-1 not implemented)', () => {
    render(
      <VariablePickerPopover
        fields={FIELDS}
        objectKey="customer"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });
});
