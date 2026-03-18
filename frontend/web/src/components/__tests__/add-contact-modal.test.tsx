import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddContactModal } from '../add-contact-modal';

// Mock TanStack Query
const mockMutateAsync = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

// Mock auth store
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

// Mock api-client — export ApiError so instanceof checks inside the component work
vi.mock('@/lib/api-client', () => {
  class MockApiError extends Error {
    status: number;
    body: { detail?: string; title?: string };
    constructor(status: number, body: { detail?: string; title?: string }) {
      super('ApiError');
      this.status = status;
      this.body = body;
    }
  }
  return {
    crmApi: { createCustomer: vi.fn() },
    ApiError: MockApiError,
  };
});

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('AddContactModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    render(<AddContactModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with all fields when open=true', () => {
    render(<AddContactModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company/i)).toBeInTheDocument();
  });

  it('shows error when submitting with empty name', async () => {
    render(<AddContactModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows error when email format is invalid', async () => {
    render(<AddContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<AddContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'alice@example.com' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '0901234567' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '0901234567',
    }));
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<AddContactModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<AddContactModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<AddContactModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
