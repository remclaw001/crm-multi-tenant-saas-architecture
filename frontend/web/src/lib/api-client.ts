// frontend/web/src/lib/api-client.ts
import type {
  Customer,
  SupportCase,
  PluginListResponse,
  LoginResponse,
  ApiErrorBody,
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
  init: RequestInit & { token?: string; tenantId?: string } = {},
): Promise<T> {
  const { token, tenantId, ...fetchInit } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
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
};
