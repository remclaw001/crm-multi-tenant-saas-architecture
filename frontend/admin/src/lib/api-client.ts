import type {
  Tenant,
  Plugin,
  MetricsSummary,
  PaginatedResponse,
  CreateTenantInput,
  UpdateTenantInput,
  AdminLoginResponse,
  ApiErrorBody,
  TenantUser,
  CreateUserInput,
  UpdateUserInput,
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
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchInit } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const adminApi = {
  // ─── Auth ─────────────────────────────────────────────────────────────────────
  login(body: { email: string; password: string }): Promise<AdminLoginResponse> {
    return request('/api/v1/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // ─── Tenants ─────────────────────────────────────────────────────────────────
  getTenants(
    params: { page?: number; limit?: number; search?: string },
    token: string,
  ): Promise<PaginatedResponse<Tenant>> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 20),
      ...(params.search ? { search: params.search } : {}),
    });
    return request(`/api/v1/admin/tenants?${qs}`, { token });
  },

  getTenant(id: string, token: string): Promise<Tenant> {
    return request(`/api/v1/admin/tenants/${id}`, { token });
  },

  createTenant(input: CreateTenantInput, token: string): Promise<Tenant> {
    return request('/api/v1/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(input),
      token,
    });
  },

  updateTenant(id: string, input: UpdateTenantInput, token: string): Promise<Tenant> {
    return request(`/api/v1/admin/tenants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      token,
    });
  },

  deleteTenant(id: string, token: string): Promise<void> {
    return request(`/api/v1/admin/tenants/${id}`, { method: 'DELETE', token });
  },

  // ─── Tenant Users ─────────────────────────────────────────────────────────────
  getUsers(tenantId: string, token: string): Promise<TenantUser[]> {
    return request(`/api/v1/admin/tenants/${tenantId}/users`, { token });
  },

  createUser(tenantId: string, input: CreateUserInput, token: string): Promise<TenantUser> {
    return request(`/api/v1/admin/tenants/${tenantId}/users`, {
      method: 'POST',
      body: JSON.stringify(input),
      token,
    });
  },

  updateUser(tenantId: string, userId: string, input: UpdateUserInput, token: string): Promise<TenantUser> {
    return request(`/api/v1/admin/tenants/${tenantId}/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      token,
    });
  },

  setUserActive(tenantId: string, userId: string, isActive: boolean, token: string): Promise<TenantUser> {
    return request(`/api/v1/admin/tenants/${tenantId}/users/${userId}/disable`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
      token,
    });
  },

  deleteUser(tenantId: string, userId: string, token: string): Promise<void> {
    return request(`/api/v1/admin/tenants/${tenantId}/users/${userId}`, {
      method: 'DELETE',
      token,
    });
  },

  // ─── Plugins ─────────────────────────────────────────────────────────────────
  getTenantPlugins(tenantId: string, token: string): Promise<Plugin[]> {
    return request(`/api/v1/admin/tenants/${tenantId}/plugins`, { token });
  },

  togglePlugin(
    tenantId: string,
    pluginId: string,
    enabled: boolean,
    token: string,
  ): Promise<{ pluginId: string; enabled: boolean }> {
    return request(`/api/v1/admin/tenants/${tenantId}/plugins/${pluginId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
      token,
    });
  },

  // ─── Metrics ─────────────────────────────────────────────────────────────────
  getMetrics(token: string): Promise<MetricsSummary> {
    return request('/api/v1/admin/metrics/summary', { token });
  },
};
