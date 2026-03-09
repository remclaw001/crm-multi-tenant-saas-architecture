export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  plan: 'standard' | 'vip' | 'enterprise';
  status: 'active' | 'suspended' | 'trial';
  pluginCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  permissions: string[];
  limits: {
    timeoutMs: number;
    memoryMb: number;
    maxQueriesPerRequest: number;
  };
}

export interface MetricsSummary {
  activeTenantsCount: number;
  requestsPerMinute: number;
  avgResponseTimeMs: number;
  errorRate: number;
  dbPoolUtilization: number;
  cacheHitRate: number;
}

export interface AdminLoginResponse {
  token: string;
  user: { id: string; email: string; role: 'super_admin' | 'admin' };
}

export interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateTenantInput {
  name: string;
  subdomain: string;
  plan: Tenant['plan'];
}

export interface UpdateTenantInput {
  name?: string;
  status?: Tenant['status'];
  plan?: Tenant['plan'];
}

export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'manager';
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: 'admin' | 'manager';
  password?: string;
}
