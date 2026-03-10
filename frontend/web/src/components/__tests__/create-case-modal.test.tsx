import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateCaseModal } from '../create-case-modal';

const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockCustomers = vi.hoisted(() => [
  { id: 'c1', name: 'Acme Corp', tenant_id: 'tid', email: null, phone: null, company: null, is_active: true, created_at: '', updated_at: '' },
  { id: 'c2', name: 'Beta Ltd',  tenant_id: 'tid', email: null, phone: null, company: null, is_active: true, created_at: '', updated_at: '' },
]);

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  useQuery: vi.fn(() => ({ data: { data: mockCustomers }, isLoading: false, isError: false })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getCustomers: vi.fn(), createCase: vi.fn() },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('CreateCaseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    render(<CreateCaseModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with all fields when open=true', () => {
    render(<CreateCaseModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/customer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /low/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /medium/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /high/i })).toBeInTheDocument();
  });

  it('shows customer options from getCustomers', () => {
    render(<CreateCaseModal {...defaultProps} />);
    expect(screen.getByRole('option', { name: /acme corp/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /beta ltd/i })).toBeInTheDocument();
  });

  it('shows error when submitting with empty title', async () => {
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows error when submitting without selecting a customer', async () => {
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    expect(await screen.findByText(/customer is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Details here' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        customer_id: 'c1',
        title: 'Login bug',
        description: 'Details here',
        priority: 'medium',
      }),
    );
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<CreateCaseModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<CreateCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Login bug' } });
    fireEvent.click(screen.getByRole('button', { name: /create case/i }));
    expect(await screen.findByText(/failed to create case/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CreateCaseModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('priority defaults to medium and can be changed', () => {
    render(<CreateCaseModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /medium/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /high/i }));
    expect(screen.getByRole('button', { name: /high/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /medium/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows error message when customer list fails to load', async () => {
    const rq = vi.mocked(await import('@tanstack/react-query'));
    rq.useQuery.mockReturnValueOnce({ data: undefined, isLoading: false, isError: true } as any);
    render(<CreateCaseModal {...defaultProps} />);
    expect(screen.getByText(/failed to load customers/i)).toBeInTheDocument();
  });
});
