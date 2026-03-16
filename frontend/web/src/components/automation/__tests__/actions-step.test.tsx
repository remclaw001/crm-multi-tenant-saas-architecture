import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionsStep } from '../actions-step';
import type { ActionDefinition } from '@/types/api.types';

// Mock TanStack Query — returns a catalog with one template-string param and one string param
const mockUseQuery = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ token: 'tok', tenantId: 'tid' })),
}));

vi.mock('@/lib/api-client', () => ({
  crmApi: { getAvailableActions: vi.fn() },
}));

const CATALOG: ActionDefinition[] = [
  {
    type: 'case.create',
    label: 'Create Support Case',
    description: 'Open a case',
    requiredPlugins: [],
    params: [
      { name: 'title',       label: 'Title',       type: 'template-string', required: true,  hint: '{{customer.name}}' },
      { name: 'description', label: 'Description', type: 'template-string', required: false, hint: '{{customer.email}}' },
      { name: 'priority',    label: 'Priority',    type: 'enum',            required: true,
        options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
      { name: 'notes',       label: 'Notes',       type: 'string',          required: false },
    ],
  },
];

const EVENT_FIELDS = [
  { name: 'name',  type: 'string' as const },
  { name: 'email', type: 'string' as const },
];

const BASE_PROPS = {
  actions:     [{ type: 'case.create', params: { title: '', description: '', priority: 'low', notes: '' } }],
  onChange:    vi.fn(),
  eventType:   'customer.create',
  eventFields: EVENT_FIELDS,
};

describe('ActionsStep', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({ data: { data: CATALOG }, isLoading: false, isError: false });
  });

  it('renders a TemplateStringInput (with {} button) for template-string params', () => {
    render(<ActionsStep {...BASE_PROPS} />);
    // Both 'title' and 'description' are template-string params → 2 {} buttons
    expect(screen.getAllByRole('button', { name: /insert variable/i })).toHaveLength(2);
  });

  it('renders a plain input for string/url params and select for enum params', () => {
    render(<ActionsStep {...BASE_PROPS} />);
    // Priority is enum → select
    expect(screen.getByRole('combobox', { name: /priority/i })).toBeInTheDocument();
    // Notes is a plain string param → plain textbox (no {} button)
    expect(screen.getByRole('textbox', { name: /notes/i })).toBeInTheDocument();
  });

  it('hides {} button when eventFields is empty', () => {
    render(<ActionsStep {...BASE_PROPS} eventFields={[]} />);
    expect(screen.queryByRole('button', { name: /insert variable/i })).not.toBeInTheDocument();
  });

  it('passes objectKey derived from eventType to TemplateStringInput', () => {
    render(<ActionsStep {...BASE_PROPS} />);
    // Open the picker on the title field
    const [titlePicker] = screen.getAllByRole('button', { name: /insert variable/i });
    fireEvent.click(titlePicker);
    // The popover should show 'name' field under 'customer' header
    expect(screen.getByText(/customer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'name' })).toBeInTheDocument();
  });
});
