import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContactsPage from '../page';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery:       mockUseQuery,
  useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getCustomers: vi.fn().mockResolvedValue({ data: [], count: 0 }) },
}));

vi.mock('@/components/plugin-gate', () => ({
  PluginGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/contacts-list', () => ({
  ContactsList: () => <div data-testid="contacts-list" />,
}));

vi.mock('@/components/add-contact-modal', () => ({
  AddContactModal: () => null,
}));

vi.mock('@/components/edit-contact-modal', () => ({
  EditContactModal: () => null,
}));

vi.mock('@/components/delete-contact-modal', () => ({
  DeleteContactModal: () => null,
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function setup() {
  mockUseQuery.mockReturnValue({ data: { data: [], count: 0 }, isLoading: false, isError: false });
  return render(<ContactsPage />);
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('ContactsPage filter form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Name, Company, Phone inputs and Status select', () => {
    setup();
    expect(screen.getByPlaceholderText(/nguyen/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/acme/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/0912/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('Status select defaults to "active"', () => {
    setup();
    expect(screen.getByRole('combobox')).toHaveValue('active');
  });

  it('renders Search and Reset buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });

  it('pressing Enter in the Name field calls useQuery with updated filter', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/nguyen/i), { target: { value: 'Alice' } });
    fireEvent.submit(screen.getByRole('form'));
    // After submit, useQuery should have been called with the new filter
    // The latest call args contain the activeFilter
    const lastCallArgs = mockUseQuery.mock.calls.at(-1)?.[0];
    expect(lastCallArgs?.queryKey).toContainEqual(expect.objectContaining({ name: 'Alice' }));
  });

  it('changing Status dropdown triggers re-query immediately', () => {
    setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inactive' } });
    const lastCallArgs = mockUseQuery.mock.calls.at(-1)?.[0];
    expect(lastCallArgs?.queryKey).toContainEqual(expect.objectContaining({ status: 'inactive' }));
  });

  it('Reset button restores Status to "active" and clears text fields', () => {
    setup();
    // Type something
    fireEvent.change(screen.getByPlaceholderText(/nguyen/i), { target: { value: 'Bob' } });
    fireEvent.submit(screen.getByRole('form'));
    // Reset
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(screen.getByPlaceholderText(/nguyen/i)).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveValue('active');
    const lastCallArgs = mockUseQuery.mock.calls.at(-1)?.[0];
    expect(lastCallArgs?.queryKey).toContainEqual(expect.objectContaining({ status: 'active' }));
  });
});
