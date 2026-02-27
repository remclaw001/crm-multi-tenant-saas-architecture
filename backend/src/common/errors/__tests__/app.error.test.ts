// ============================================================
// Error Hierarchy Tests — AppError, DomainError, PluginError, ValidationError
// ============================================================
import { describe, it, expect } from 'vitest';
import { AppError } from '../app.error';
import {
  DomainError,
  TenantNotFoundError,
  TenantInactiveError,
  PluginDisabledError,
  PermissionDeniedError,
  ResourceNotFoundError,
  ConflictError,
} from '../domain.errors';
import {
  PluginError,
  PluginTimeoutError,
  PluginQueryLimitError,
  PluginNotFoundError,
  PluginExecutionError,
} from '../plugin.errors';
import { ValidationError } from '../validation.errors';

// ── AppError (base) ──────────────────────────────────────────
describe('AppError', () => {
  it('sets message, statusCode, code, and name', () => {
    const err = new AppError('something failed', 503, 'SERVICE_UNAVAILABLE');
    expect(err.message).toBe('something failed');
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.name).toBe('AppError');
  });

  it('is an instance of Error', () => {
    const err = new AppError('test', 500, 'TEST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('has a stack trace', () => {
    const err = new AppError('test', 500, 'TEST');
    expect(err.stack).toBeDefined();
  });
});

// ── DomainError ──────────────────────────────────────────────
describe('DomainError', () => {
  it('is an instance of AppError', () => {
    const err = new DomainError('domain error', 422, 'DOMAIN_ERR');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(DomainError);
  });

  describe('TenantNotFoundError', () => {
    it('status 404, code TENANT_NOT_FOUND', () => {
      const err = new TenantNotFoundError('acme');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('TENANT_NOT_FOUND');
      expect(err.message).toContain('acme');
      expect(err).toBeInstanceOf(DomainError);
    });
  });

  describe('TenantInactiveError', () => {
    it('status 403, code TENANT_INACTIVE', () => {
      const err = new TenantInactiveError('acme');
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('TENANT_INACTIVE');
      expect(err.message).toContain('acme');
    });
  });

  describe('PluginDisabledError', () => {
    it('status 403, code PLUGIN_DISABLED', () => {
      const err = new PluginDisabledError('analytics');
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('PLUGIN_DISABLED');
      expect(err.message).toContain('analytics');
    });
  });

  describe('PermissionDeniedError', () => {
    it('status 403, code PERMISSION_DENIED', () => {
      const err = new PermissionDeniedError('customers', 'delete');
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.message).toContain('delete');
      expect(err.message).toContain('customers');
    });
  });

  describe('ResourceNotFoundError', () => {
    it('status 404, code RESOURCE_NOT_FOUND', () => {
      const err = new ResourceNotFoundError('Customer', '123');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('RESOURCE_NOT_FOUND');
      expect(err.message).toContain('Customer');
      expect(err.message).toContain('123');
    });
  });

  describe('ConflictError', () => {
    it('status 409, code CONFLICT', () => {
      const err = new ConflictError('Email already exists');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe('Email already exists');
    });
  });
});

// ── PluginError ──────────────────────────────────────────────
describe('PluginError', () => {
  it('is an instance of AppError', () => {
    const err = new PluginError('plugin err', 502, 'PLUGIN_ERR', 'my-plugin');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(PluginError);
    expect(err.pluginName).toBe('my-plugin');
  });

  describe('PluginTimeoutError', () => {
    it('status 504, code PLUGIN_TIMEOUT', () => {
      const err = new PluginTimeoutError('analytics', 5000);
      expect(err.statusCode).toBe(504);
      expect(err.code).toBe('PLUGIN_TIMEOUT');
      expect(err.pluginName).toBe('analytics');
      expect(err.message).toContain('5000ms');
    });
  });

  describe('PluginQueryLimitError', () => {
    it('status 429, code PLUGIN_QUERY_LIMIT', () => {
      const err = new PluginQueryLimitError('analytics', 50);
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('PLUGIN_QUERY_LIMIT');
      expect(err.message).toContain('50');
    });
  });

  describe('PluginNotFoundError', () => {
    it('status 404, code PLUGIN_NOT_FOUND', () => {
      const err = new PluginNotFoundError('unknown-plugin');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('PLUGIN_NOT_FOUND');
    });
  });

  describe('PluginExecutionError', () => {
    it('status 502, code PLUGIN_EXECUTION_ERROR', () => {
      const err = new PluginExecutionError('marketing', 'NullPointerException');
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('PLUGIN_EXECUTION_ERROR');
      expect(err.message).toContain('NullPointerException');
    });
  });
});

// ── ValidationError ──────────────────────────────────────────
describe('ValidationError', () => {
  it('status 400, code VALIDATION_ERROR', () => {
    const err = new ValidationError('Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fields).toBeUndefined();
    expect(err).toBeInstanceOf(AppError);
  });

  it('stores fields map when provided', () => {
    const err = new ValidationError('Invalid input', {
      email: ['must be a valid email'],
      phone: ['required', 'must be 10 digits'],
    });
    expect(err.fields).toEqual({
      email: ['must be a valid email'],
      phone: ['required', 'must be 10 digits'],
    });
  });
});

// ── instanceof across hierarchy ──────────────────────────────
describe('instanceof hierarchy', () => {
  it('TenantNotFoundError is DomainError, AppError, and Error', () => {
    const err = new TenantNotFoundError('x');
    expect(err).toBeInstanceOf(TenantNotFoundError);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('PluginTimeoutError is PluginError, AppError, and Error', () => {
    const err = new PluginTimeoutError('p', 3000);
    expect(err).toBeInstanceOf(PluginTimeoutError);
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });
});
