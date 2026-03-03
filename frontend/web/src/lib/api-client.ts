import type {
  Contact,
  Deal,
  Task,
  PaginatedResponse,
  ApiErrorBody,
} from '@/types/api.types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

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
  init: RequestInit & { token: string; tenantId: string } = {} as never,
): Promise<T> {
  const { token, tenantId, ...fetchInit } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': tenantId,
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

// Auth context passed into every call instead of baking it into headers globally.
// This keeps the client stateless and testable without mocking module state.
interface AuthCtx {
  token: string;
  tenantId: string;
}

export const crmApi = {
  // ─── Contacts ────────────────────────────────────────────────────────────────
  getContacts(
    params: { page?: number; limit?: number; search?: string; status?: string },
    ctx: AuthCtx,
  ): Promise<PaginatedResponse<Contact>> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 20),
      ...(params.search ? { search: params.search } : {}),
      ...(params.status ? { status: params.status } : {}),
    });
    return request(`/api/v1/customer-data/contacts?${qs}`, ctx);
  },

  getContact(id: string, ctx: AuthCtx): Promise<Contact> {
    return request(`/api/v1/customer-data/contacts/${id}`, ctx);
  },

  createContact(
    input: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>,
    ctx: AuthCtx,
  ): Promise<Contact> {
    return request('/api/v1/customer-data/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  updateContact(
    id: string,
    input: Partial<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>>,
    ctx: AuthCtx,
  ): Promise<Contact> {
    return request(`/api/v1/customer-data/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  deleteContact(id: string, ctx: AuthCtx): Promise<void> {
    return request(`/api/v1/customer-data/contacts/${id}`, { method: 'DELETE', ...ctx });
  },

  // ─── Deals ───────────────────────────────────────────────────────────────────
  getDeals(
    params: { page?: number; limit?: number; stage?: string },
    ctx: AuthCtx,
  ): Promise<PaginatedResponse<Deal>> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 20),
      ...(params.stage ? { stage: params.stage } : {}),
    });
    return request(`/api/v1/customer-care/deals?${qs}`, ctx);
  },

  createDeal(input: Omit<Deal, 'id' | 'createdAt'>, ctx: AuthCtx): Promise<Deal> {
    return request('/api/v1/customer-care/deals', {
      method: 'POST',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  updateDeal(id: string, input: Partial<Deal>, ctx: AuthCtx): Promise<Deal> {
    return request(`/api/v1/customer-care/deals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  // ─── Tasks ───────────────────────────────────────────────────────────────────
  getTasks(
    params: { page?: number; limit?: number; status?: string; priority?: string },
    ctx: AuthCtx,
  ): Promise<PaginatedResponse<Task>> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 20),
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
    });
    return request(`/api/v1/automation/tasks?${qs}`, ctx);
  },

  updateTask(id: string, input: Partial<Task>, ctx: AuthCtx): Promise<Task> {
    return request(`/api/v1/automation/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      ...ctx,
    });
  },

  // ─── Plugins ─────────────────────────────────────────────────────────────────
  getEnabledPlugins(ctx: AuthCtx): Promise<{ enabledPlugins: string[] }> {
    return request('/api/v1/plugins', ctx);
  },
};
