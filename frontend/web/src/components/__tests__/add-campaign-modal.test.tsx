import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddCampaignModal } from '../add-campaign-modal';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
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

// Export ApiError from the mock so instanceof checks inside the component work
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
    crmApi: { createCampaign: vi.fn() },
    ApiError: MockApiError,
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────
const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────
describe('AddCampaignModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    render(<AddCampaignModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with all fields when open=true', () => {
    render(<AddCampaignModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/campaign name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/schedule date/i)).toBeInTheDocument();
  });

  it('type select defaults to "email"', () => {
    render(<AddCampaignModal {...defaultProps} />);
    expect(screen.getByLabelText(/^type$/i)).toHaveValue('email');
  });

  it('shows validation error when submitting with empty name', async () => {
    render(<AddCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls createCampaign with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<AddCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Test Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'Test Campaign',
        campaign_type: 'email',
        scheduled_at: undefined,
      }),
    );
  });

  it('calls onSuccess and onClose after successful mutation', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<AddCampaignModal open={true} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Test Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync rejects with ApiError', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mockMutateAsync.mockRejectedValue(new (ApiError as any)(500, { detail: 'Something went wrong' }));
    render(<AddCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('resets form when modal closes (open → false)', () => {
    const { rerender } = render(<AddCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'My Campaign' } });
    rerender(<AddCampaignModal {...defaultProps} open={false} />);
    rerender(<AddCampaignModal {...defaultProps} open={true} />);
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue('');
  });
});
