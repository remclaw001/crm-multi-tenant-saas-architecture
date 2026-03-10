import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateTriggerModal } from '../create-trigger-modal';

const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false, reset: vi.fn() })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { createTrigger: vi.fn() },
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('CreateTriggerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Visibility ──────────────────────────────────────────────────────────────
  it('renders nothing when open=false', () => {
    render(<CreateTriggerModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open=true', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ── Step 1 fields ───────────────────────────────────────────────────────────
  it('shows step 1 fields by default', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByLabelText(/trigger name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/event type/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('"Next" button is disabled when name is empty', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('"Next" button is enabled when name is filled', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('active toggle defaults to ON', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('switch', { name: /active when created/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('active toggle can be turned off', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('switch', { name: /active when created/i }));
    expect(screen.getByRole('switch', { name: /active when created/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('event type dropdown has customer.create option', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    expect(screen.getByRole('option', { name: 'customer.create' })).toBeInTheDocument();
  });

  // ── Step navigation ─────────────────────────────────────────────────────────
  it('advances to step 2 when Next is clicked with a name', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('button', { name: /create trigger/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('"Back" button returns to step 1', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  // ── Step 2 condition builder ─────────────────────────────────────────────────
  it('step 2 starts with no condition rows', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.queryByLabelText(/attribute/i)).not.toBeInTheDocument();
  });

  it('"+ Add condition" adds a condition row', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(screen.getAllByLabelText(/attribute/i)).toHaveLength(1);
  });

  it('remove button deletes a condition row', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove condition/i }));
    expect(screen.queryByLabelText(/attribute/i)).not.toBeInTheDocument();
  });

  it('AND badge appears between two condition rows', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(screen.getByText('AND')).toBeInTheDocument();
  });

  it('value input is hidden for is_empty operator', () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.change(screen.getByLabelText(/operator/i), { target: { value: 'is_empty' } });
    expect(screen.queryByLabelText(/value/i)).not.toBeInTheDocument();
  });

  // ── Submission ──────────────────────────────────────────────────────────────
  it('submits with empty conditions as {}', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Trigger', conditions: {}, actions: [] }),
      ),
    );
  });

  it('submits with AND conditions when rows are filled', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    fireEvent.change(screen.getByLabelText(/attribute/i), { target: { value: 'company' } });
    fireEvent.change(screen.getByLabelText(/operator/i), { target: { value: 'equals' } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: { and: [{ field: 'company', op: 'equals', value: 'Acme' }] },
        }),
      ),
    );
  });

  it('does not submit if a condition row is missing a value', async () => {
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /add condition/i }));
    // leave value empty
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    expect(await screen.findByText(/value is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls onSuccess and onClose after successful submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<CreateTriggerModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error when mutateAsync throws', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Server error'));
    render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }));
    expect(await screen.findByText(/failed to create trigger/i)).toBeInTheDocument();
  });

  it('calls onClose when × is clicked', () => {
    const onClose = vi.fn();
    render(<CreateTriggerModal open={true} onClose={onClose} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('resets to step 1 when modal is reopened', () => {
    const { rerender } = render(<CreateTriggerModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/trigger name/i), { target: { value: 'My Trigger' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // close then reopen
    rerender(<CreateTriggerModal {...defaultProps} open={false} />);
    rerender(<CreateTriggerModal {...defaultProps} open={true} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/trigger name/i)).toHaveValue('');
  });
});
