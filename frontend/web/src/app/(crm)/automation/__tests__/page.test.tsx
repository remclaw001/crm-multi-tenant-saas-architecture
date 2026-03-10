import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AutomationPage from '../page';

const mockRefetch = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({
    data: { count: 2, data: [] },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getTriggers: vi.fn(), getEnabledPlugins: vi.fn() },
}));

vi.mock('@/components/triggers-list', () => ({
  TriggersList: () => <div data-testid="triggers-list" />,
}));

vi.mock('@/components/plugin-gate', () => ({
  PluginGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/create-trigger-modal', () => ({
  CreateTriggerModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div role="dialog" data-testid="create-trigger-modal"><button onClick={onClose}>Close</button></div> : null,
}));

describe('AutomationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "+ Add Trigger" button', () => {
    render(<AutomationPage />);
    expect(screen.getByRole('button', { name: /add trigger/i })).toBeInTheDocument();
  });

  it('opens CreateTriggerModal when button is clicked', () => {
    render(<AutomationPage />);
    expect(screen.queryByTestId('create-trigger-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add trigger/i }));
    expect(screen.getByTestId('create-trigger-modal')).toBeInTheDocument();
  });

  it('closes modal when onClose is called', () => {
    render(<AutomationPage />);
    fireEvent.click(screen.getByRole('button', { name: /add trigger/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('create-trigger-modal')).not.toBeInTheDocument();
  });
});
