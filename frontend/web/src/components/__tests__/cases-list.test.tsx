import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SupportCase } from '@/types/api.types';
import { CasesList } from '../cases-list';

const supportCase: SupportCase = {
  id: 'case-1',
  tenant_id: 'tid',
  customer_id: 'c1',
  customer_name: 'Acme Corp',
  title: 'Login page crashes on Safari',
  description: null,
  status: 'open',
  priority: 'high',
  assigned_to: null,
  resolved_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

describe('CasesList', () => {
  it('shows "No cases found" when list is empty', () => {
    render(<CasesList cases={[]} onEdit={vi.fn()} />);
    expect(screen.getByText(/no cases found/i)).toBeInTheDocument();
  });

  it('renders case title', () => {
    render(<CasesList cases={[supportCase]} onEdit={vi.fn()} />);
    expect(screen.getByText('Login page crashes on Safari')).toBeInTheDocument();
  });

  it('calls onEdit with the correct case when a card is clicked', () => {
    const onEdit = vi.fn();
    render(<CasesList cases={[supportCase]} onEdit={onEdit} />);
    fireEvent.click(screen.getByText('Login page crashes on Safari'));
    expect(onEdit).toHaveBeenCalledWith(supportCase);
  });
});
