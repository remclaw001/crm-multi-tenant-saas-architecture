// Re-export the same contract types used in the web app for type sharing.
// In a monorepo, this would import from a @crm/shared package instead.

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  status: 'lead' | 'prospect' | 'customer' | 'churned';
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  value: number;
  currency: string;
  closeDate: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  relatedTo?: { type: 'contact' | 'deal'; id: string; name: string };
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.detail ?? body.title);
    this.name = 'ApiError';
  }
}

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

interface AuthCtx {
  token: string;
  tenantId: string;
}

async function request<T>(path: string, init: RequestInit & AuthCtx): Promise<T> {
  const { token, tenantId, ...fetchInit } = init;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...fetchInit,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-ID': tenantId,
      ...(fetchInit.headers as Record<string, string> | undefined),
    },
  });

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

export const crmApi = {
  getContacts(
    params: { page?: number; limit?: number; search?: string },
    ctx: AuthCtx,
  ): Promise<PaginatedResponse<Contact>> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 20),
      ...(params.search ? { search: params.search } : {}),
    });
    return request(`/api/v1/customer-data/contacts?${qs}`, ctx);
  },

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

  getTasks(
    params: { page?: number; limit?: number; status?: string },
    ctx: AuthCtx,
  ): Promise<PaginatedResponse<Task>> {
    const qs = new URLSearchParams({
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 20),
      ...(params.status ? { status: params.status } : {}),
    });
    return request(`/api/v1/automation/tasks?${qs}`, ctx);
  },
};
