import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminApi, ApiError } from '@/lib/api-client';
import type { Tenant } from '@/types/api.types';

const mockTenant: Tenant = {
  id: 'tenant-1',
  name: 'Acme Corp',
  subdomain: 'acme',
  plan: 'standard',
  status: 'active',
  pluginCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeFetchMock(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', undefined);
});

describe('adminApi.getTenants', () => {
  it('sends Authorization header and returns paginated tenants', async () => {
    const fetchMock = makeFetchMock({ data: [mockTenant], total: 1, page: 1, limit: 20 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminApi.getTenants({ page: 1, limit: 20 }, 'test-token');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Acme Corp');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/tenants'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('appends search param to URL when provided', async () => {
    const fetchMock = makeFetchMock({ data: [], total: 0, page: 1, limit: 20 });
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.getTenants({ search: 'acme' }, 'token');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('search=acme');
  });

  it('omits search param when not provided', async () => {
    const fetchMock = makeFetchMock({ data: [], total: 0, page: 1, limit: 20 });
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.getTenants({ page: 1 }, 'token');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).not.toContain('search=');
  });
});

describe('adminApi error handling', () => {
  it('throws ApiError on non-2xx response', async () => {
    const fetchMock = makeFetchMock(
      {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Tenant not found',
        instance: '/api/v1/admin/tenants/bad',
      },
      404,
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(adminApi.getTenant('bad', 'token')).rejects.toThrow(ApiError);
  });

  it('ApiError exposes status code and message', async () => {
    const fetchMock = makeFetchMock(
      {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Tenant not found',
        instance: '/api/v1/admin/tenants/bad',
      },
      404,
    );
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await adminApi.getTenant('bad', 'token');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
    expect((caught as ApiError).message).toBe('Tenant not found');
  });
});

describe('adminApi.createTenant', () => {
  it('sends POST with correct body', async () => {
    const fetchMock = makeFetchMock(mockTenant, 201);
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.createTenant({ name: 'Acme Corp', subdomain: 'acme', plan: 'standard' }, 'token');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Acme Corp');
    expect(body.subdomain).toBe('acme');
  });
});

describe('adminApi.togglePlugin', () => {
  it('sends PATCH with enabled flag', async () => {
    const fetchMock = makeFetchMock({ pluginId: 'p1', enabled: true });
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.togglePlugin('tenant-1', 'p1', true, 'token');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
  });

  it('includes tenant ID in URL', async () => {
    const fetchMock = makeFetchMock({ pluginId: 'p1', enabled: false });
    vi.stubGlobal('fetch', fetchMock);

    await adminApi.togglePlugin('tenant-42', 'p1', false, 'token');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('/tenant-42/plugins/p1');
  });
});
