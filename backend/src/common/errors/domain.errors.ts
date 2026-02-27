// ============================================================
// DomainError — Business logic violation errors
//
// Subclass của AppError. Dùng cho các vi phạm business rules:
//   - Resource không tìm thấy (404)
//   - Tenant không hoạt động (403)
//   - Plugin bị disabled (403)
//   - Không có quyền (403)
//   - Conflict (409)
// ============================================================
import { AppError } from './app.error';

// ── Base DomainError ────────────────────────────────────────
export class DomainError extends AppError {
  constructor(message: string, statusCode: number, code: string) {
    super(message, statusCode, code);
  }
}

// ── Tenant errors ───────────────────────────────────────────

export class TenantNotFoundError extends DomainError {
  constructor(identifier: string) {
    super(`Tenant not found: ${identifier}`, 404, 'TENANT_NOT_FOUND');
  }
}

export class TenantInactiveError extends DomainError {
  constructor(subdomain: string) {
    super(`Tenant is inactive: ${subdomain}`, 403, 'TENANT_INACTIVE');
  }
}

// ── Plugin enablement ───────────────────────────────────────

export class PluginDisabledError extends DomainError {
  constructor(pluginName: string) {
    super(
      `Plugin '${pluginName}' is not enabled for this tenant`,
      403,
      'PLUGIN_DISABLED',
    );
  }
}

// ── Auth / Permission ───────────────────────────────────────

export class PermissionDeniedError extends DomainError {
  constructor(resource: string, action: string) {
    super(`Permission denied: ${action} on ${resource}`, 403, 'PERMISSION_DENIED');
  }
}

// ── Resource CRUD ───────────────────────────────────────────

export class ResourceNotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, 'RESOURCE_NOT_FOUND');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}
