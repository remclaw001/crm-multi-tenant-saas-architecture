import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Customer } from '@/types/api.types';
import { DeleteContactModal } from '../delete-contact-modal';

const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { deleteCustomer: vi.fn() },
}));

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

const defaultProps = {
  contact,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('DeleteContactModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with contact name', () => {
    render(<DeleteContactModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('calls mutateAsync with contact id on confirm', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    render(<DeleteContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith('c-1'));
  });

  it('calls onSuccess and onClose after successful delete', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<DeleteContactModal contact={contact} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<DeleteContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(await screen.findByText(/failed to delete/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<DeleteContactModal contact={contact} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
