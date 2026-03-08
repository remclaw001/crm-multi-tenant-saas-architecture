import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Customer } from '@/types/api.types';
import { ContactsList } from '../contacts-list';

const contact: Customer = {
  id: 'c-1',
  tenant_id: 't-1',
  name: 'Alice',
  email: 'alice@example.com',
  phone: '0901234567',
  company: 'Acme',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ContactsList', () => {
  it('calls onEdit with the correct contact when pencil button is clicked', () => {
    const onEdit = vi.fn();
    render(<ContactsList contacts={[contact]} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(contact);
  });
});
