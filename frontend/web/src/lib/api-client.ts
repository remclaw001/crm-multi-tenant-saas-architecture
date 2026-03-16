// frontend/web/src/lib/api-client.ts
import type {
  Customer,
  SupportCase,
  TenantUser,
  AnalyticsSummary,
  TrendPoint,
  AutomationTrigger,
  ActionDefinition,
  StoredAction,
  Campaign,
  PluginListResponse,
  PluginItemResponse,
  LoginResponse,
  RefreshResponse,
  ApiErrorBody,
  AvailableEvent,
} from '@/types/api.types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.detail ?? body.title);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; tenantId?: string; tenantSlug?: string } = {},
): Promise<T> {
  const { token, tenantId, tenantSlug, ...fetchInit } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {}),
    ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchInit.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...fetchInit, headers });

  if (!res.ok) {
    const body: ApiErrorBody = await res.json().catch(() => ({
      type: 'about:blank',
      title: res.statusText,
      status: res.status,
      detail: res.statusText,
      instance: path,
    }));
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

interface AuthCtx {
  token: string;
  tenantId: string;
}

export const crmApi = {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  login(body: { tenantSlug: string; email: string; password: string }): Promise<LoginResponse> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
      tenantSlug: body.tenantSlug,
    });
  },

  refresh(refreshToken: string): Promise<RefreshResponse> {
    return request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  logout(token: string, tenantId: string): Promise<void> {
    return request('/auth/logout', {
      method: 'POST',
      token,
      tenantId,
    });
  },

  // ─── Plugins ──────────────────────────────────────────────────────────────
  getEnabledPlugins(ctx: AuthCtx): Promise<{ enabledPlugins: string[] }> {
    return request('/api/v1/plugins', ctx);
  },

  // ─── Customers (customer-data plugin) ────────────────────────────────────
  getCustomers(ctx: AuthCtx): Promise<PluginListResponse<Customer>> {
    return request('/api/v1/plugins/customer-data/customers', ctx);
  },

  getCustomer(id: string, ctx: AuthCtx): Promise<{ plugin: string; data: Customer }> {
    return request(`/api/v1/plugins/customer-data/customers/${id}`, ctx);
  },

  createCustomer(
    input: { name: string; email?: string; phone?: string; company?: string },
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: Customer }> {
    return request('/api/v1/plugins/customer-data/customers', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  updateCustomer(
    id: string,
    input: { name?: string; email?: string | null; phone?: string | null; company?: string | null },
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: Customer }> {
    return request(`/api/v1/plugins/customer-data/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  deleteCustomer(id: string, ctx: AuthCtx): Promise<void> {
    return request(`/api/v1/plugins/customer-data/customers/${id}`, {
      method: 'DELETE',
      ...ctx,
    });
  },

  // ─── Cases (customer-care plugin) ─────────────────────────────────────────
  getCases(ctx: AuthCtx): Promise<PluginListResponse<SupportCase>> {
    return request('/api/v1/plugins/customer-care/cases', ctx);
  },

  createCase(
    input: { customer_id: string; title: string; description?: string; priority?: string },
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: SupportCase }> {
    return request('/api/v1/plugins/customer-care/cases', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  updateCase(
    id: string,
    input: Partial<Pick<SupportCase, 'title' | 'description' | 'status' | 'priority' | 'assigned_to'>>,
    ctx: AuthCtx,
  ): Promise<{ plugin: string; data: SupportCase }> {
    return request(`/api/v1/plugins/customer-care/cases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  getUsers(ctx: AuthCtx): Promise<TenantUser[]> {
    return request('/api/v1/users', ctx);
  },

  // ─── Analytics (read-only) ────────────────────────────────────────────────
  getAnalyticsSummary(ctx: AuthCtx): Promise<{ plugin: string; reportType: string; data: AnalyticsSummary }> {
    return request('/api/v1/plugins/analytics/reports/summary', ctx);
  },

  getAnalyticsTrends(ctx: AuthCtx): Promise<{ plugin: string; reportType: string; data: TrendPoint[] }> {
    return request('/api/v1/plugins/analytics/reports/trends', ctx);
  },

  // ─── Automation ───────────────────────────────────────────────────────────
  getTriggers(ctx: AuthCtx): Promise<PluginListResponse<AutomationTrigger>> {
    return request('/api/v1/plugins/automation/triggers', ctx);
  },

  getAvailableActions(ctx: AuthCtx): Promise<{ plugin: string; data: ActionDefinition[] }> {
    return request('/api/v1/plugins/automation/actions', ctx);
  },

  getAvailableEvents(ctx: AuthCtx): Promise<{ plugin: string; data: AvailableEvent[] }> {
    return request('/api/v1/plugins/automation/events', ctx);
  },

  createTrigger(
    input: { name: string; event_type: string; conditions?: Record<string, unknown>; actions?: StoredAction[]; is_active?: boolean },
    ctx: AuthCtx,
  ): Promise<PluginItemResponse<AutomationTrigger>> {
    return request('/api/v1/plugins/automation/triggers', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  updateTrigger(
    id: string,
    input: { name?: string; event_type?: string; conditions?: Record<string, unknown>; actions?: StoredAction[]; is_active?: boolean },
    ctx: AuthCtx,
  ): Promise<PluginItemResponse<AutomationTrigger>> {
    return request(`/api/v1/plugins/automation/triggers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  deleteTrigger(id: string, ctx: AuthCtx): Promise<void> {
    return request(`/api/v1/plugins/automation/triggers/${id}`, {
      method: 'DELETE',
      ...ctx,
    });
  },

  // ─── Marketing ────────────────────────────────────────────────────────────
  getCampaigns(ctx: AuthCtx): Promise<PluginListResponse<Campaign>> {
    return request('/api/v1/plugins/marketing/campaigns', ctx);
  },

  createCampaign(
    input: { name: string; campaign_type?: 'email' | 'sms'; scheduled_at?: string },
    ctx: AuthCtx,
  ): Promise<PluginItemResponse<Campaign>> {
    return request('/api/v1/plugins/marketing/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },
};
