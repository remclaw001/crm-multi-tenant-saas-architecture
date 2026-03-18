import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditCampaignModal } from '../edit-campaign-modal';
import type { Campaign } from '@/types/api.types';

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
    crmApi: { updateCampaign: vi.fn() },
    ApiError: MockApiError,
  };
});

// ── Fixture ────────────────────────────────────────────────────────────────
const mockCampaign: Campaign = {
  id: 'camp-1',
  tenant_id: 'tid',
  name: 'Summer Sale',
  status: 'draft',
  campaign_type: 'email',
  target_count: 500,
  sent_count: 0,
  scheduled_at: '2026-06-15T10:00:00.000Z',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
};

const defaultProps = {
  campaign: mockCampaign,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────
describe('EditCampaignModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when campaign is null', () => {
    render(<EditCampaignModal campaign={null} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders all 4 fields pre-filled with campaign values', () => {
    render(<EditCampaignModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue('Summer Sale');
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('draft');
    expect(screen.getByLabelText(/target count/i)).toHaveValue(500);
    expect(screen.getByLabelText(/schedule date/i)).toHaveValue('2026-06-15T10:00');
  });

  it('shows validation error when submitting with empty name', async () => {
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('calls updateCampaign with correct payload on valid submit', async () => {
    mockMutateAsync.mockResolvedValue({});
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'Summer Sale',
        status: 'draft',
        target_count: 500,
        scheduled_at: '2026-06-15T10:00',
      }),
    );
  });

  it('calls onSuccess and onClose after successful mutation', async () => {
    mockMutateAsync.mockResolvedValue({});
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EditCampaignModal campaign={mockCampaign} onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows API error message when mutateAsync rejects with ApiError', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mockMutateAsync.mockRejectedValue(new (ApiError as any)(422, { detail: 'Name too long' }));
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/name too long/i)).toBeInTheDocument();
  });

  it('shows generic error when mutateAsync rejects with unknown error', async () => {
    mockMutateAsync.mockRejectedValue(new Error('network failure'));
    render(<EditCampaignModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <EditCampaignModal campaign={mockCampaign} onClose={onClose} onSuccess={vi.fn()} />,
    );
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('form re-initializes when campaign prop changes', () => {
    const other: Campaign = { ...mockCampaign, id: 'camp-2', name: 'Winter Promo' };
    const { rerender } = render(<EditCampaignModal {...defaultProps} />);
    rerender(<EditCampaignModal campaign={other} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByLabelText(/campaign name/i)).toHaveValue('Winter Promo');
  });

  it('target_count shows empty string when campaign target_count is 0', () => {
    render(
      <EditCampaignModal
        campaign={{ ...mockCampaign, target_count: 0 }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/target count/i)).toHaveValue(null);
  });
});
