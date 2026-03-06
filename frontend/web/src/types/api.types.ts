// frontend/web/src/types/api.types.ts

/** Matches backend Customer entity (customers table) */
export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Matches backend SupportCase entity (support_cases table) */
export interface SupportCase {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Backend list response: { plugin, data, count } */
export interface PluginListResponse<T> {
  plugin: string;
  data: T[];
  count: number;
}

/** Backend single-item response: { plugin, data } */
export interface PluginItemResponse<T> {
  plugin: string;
  data: T;
}

export interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string; roles: string[] };
  tenant: { id: string; subdomain: string; name: string; tier: string };
}

/** Analytics plugin */
export interface AnalyticsSummary {
  totalCustomers: number;
  activeCustomers: number;
  tenantId: string;
  generatedAt: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

/** Automation plugin */
export interface AutomationTrigger {
  id: string;
  tenant_id: string;
  name: string;
  event_type: string;
  conditions: Record<string, unknown>;
  actions: unknown[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Marketing plugin */
export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  campaign_type: 'email' | 'sms';
  target_count: number;
  sent_count: number;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}
