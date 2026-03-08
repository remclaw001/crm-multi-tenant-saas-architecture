import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Customer } from '@/types/api.types';
import { EditContactModal } from '../edit-contact-modal';

// Vitest hoisting — MUST use vi.hoisted() for variables inside vi.mock() factories
const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { updateCustomer: vi.fn() },
}));

const baseContact: Customer = {
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
  contact: baseContact,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('EditContactModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with pre-filled fields from contact', () => {
    render(<EditContactModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('Alice');
    expect(screen.getByLabelText(/email/i)).toHaveValue('alice@example.com');
    expect(screen.getByLabelText(/phone/i)).toHaveValue('0901234567');
    expect(screen.getByLabelText(/company/i)).toHaveValue('Acme');
  });

  it('shows error when submitting with empty name', async () => {
    render(<EditContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows error when email format is invalid', async () => {
    render(<EditContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bad-email' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with contact id and updated payload', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 'c-1',
        input: {
          name: 'Alice Updated',
          email: 'alice@example.com',
          phone: '0901234567',
          company: 'Acme',
        },
      }),
    );
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EditContactModal contact={baseContact} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<EditContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<EditContactModal contact={baseContact} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
