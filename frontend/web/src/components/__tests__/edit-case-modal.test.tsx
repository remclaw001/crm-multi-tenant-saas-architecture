import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SupportCase } from '@/types/api.types';
import { EditCaseModal } from '../edit-case-modal';

// Vitest hoisting — MUST use vi.hoisted() for all variables referenced in vi.mock() factories
const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() =>
  vi.fn(() => ({
    data: [
      { id: 'u1', name: 'Alice', email: 'alice@acme.com' },
      { id: 'u2', name: 'Bob', email: 'bob@acme.com' },
    ],
    isLoading: false,
    isError: false,
  })),
);

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  useQuery: mockUseQuery,
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { updateCase: vi.fn(), getUsers: vi.fn() },
}));

const baseCase: SupportCase = {
  id: 'case-1',
  tenant_id: 'tid',
  customer_id: 'c1',
  customer_name: 'Acme Corp',
  title: 'Login page crashes on Safari',
  description: 'Steps to reproduce...',
  status: 'in_progress',
  priority: 'high',
  assigned_to: 'u1',
  resolved_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const defaultProps = {
  supportCase: baseCase,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('EditCaseModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with all fields pre-filled from supportCase', () => {
    render(<EditCaseModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue('Login page crashes on Safari');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Steps to reproduce...');
    expect(screen.getByLabelText(/status/i)).toHaveValue('in_progress');
    expect(screen.getByRole('button', { name: /high/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /low/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows "Title is required" when submitted with empty title', async () => {
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls mutateAsync with correct full payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Updated title' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'New desc' } });
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'resolved' } });
    fireEvent.click(screen.getByRole('button', { name: /medium/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        title: 'Updated title',
        description: 'New desc',
        status: 'resolved',
        priority: 'medium',
        assigned_to: 'u1',
      }),
    );
  });

  it('sends assigned_to: null (not missing key) when Unassigned is selected', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/assigned to/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_to: null }),
      ),
    );
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EditCaseModal supportCase={baseCase} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('server error'));
    render(<EditCaseModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(<EditCaseModal supportCase={baseCase} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders all four status options', () => {
    render(<EditCaseModal {...defaultProps} />);
    const statusSelect = screen.getByLabelText(/status/i);
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /open/i }));
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /in progress/i }));
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /resolved/i }));
    expect(statusSelect).toContainElement(screen.getByRole('option', { name: /closed/i }));
  });

  it('renders user options in Assigned To dropdown', () => {
    render(<EditCaseModal {...defaultProps} />);
    expect(screen.getByRole('option', { name: /alice/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /bob/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /unassigned/i })).toBeInTheDocument();
  });

  it('shows "Loading users…" and disables select while users are loading', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: true, isError: false });
    render(<EditCaseModal {...defaultProps} />);
    const select = screen.getByLabelText(/assigned to/i);
    expect(select).toBeDisabled();
    expect(screen.getByRole('option', { name: /loading users/i })).toBeInTheDocument();
  });

  it('shows "Failed to load users" and disables select on users fetch error', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: false, isError: true });
    render(<EditCaseModal {...defaultProps} />);
    const select = screen.getByLabelText(/assigned to/i);
    expect(select).toBeDisabled();
    expect(screen.getByRole('option', { name: /failed to load users/i })).toBeInTheDocument();
  });

  it('resets form when supportCase.id changes', () => {
    const { rerender } = render(<EditCaseModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Dirty value' } });

    const newCase: SupportCase = { ...baseCase, id: 'case-2', title: 'Different case' };
    rerender(<EditCaseModal supportCase={newCase} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByLabelText(/title/i)).toHaveValue('Different case');
  });
});
