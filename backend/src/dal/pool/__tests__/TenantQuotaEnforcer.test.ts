import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { TenantQuotaEnforcer } from '../TenantQuotaEnforcer';

beforeEach(() => {
  TenantQuotaEnforcer.reset(); // clear all slots between tests
});

describe('TenantQuotaEnforcer.register', () => {
  it('registers a tenant slot with tier cap', () => {
    TenantQuotaEnforcer.register('t1', 'basic');
    expect(() => TenantQuotaEnforcer.acquireSync('t1')).not.toThrow();
  });

  it('VIP tenants are exempt (no slot created)', () => {
    TenantQuotaEnforcer.register('t-vip', 'vip');
    expect(() => TenantQuotaEnforcer.acquireSync('t-vip')).not.toThrow();
  });
});

describe('TenantQuotaEnforcer cap enforcement', () => {
  it('allows up to max concurrent connections', () => {
    TenantQuotaEnforcer.register('t2', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('t2');
    expect(() => TenantQuotaEnforcer.acquireSync('t2', 0)).toThrow(ServiceUnavailableException);
  });

  it('allows acquire after release', () => {
    TenantQuotaEnforcer.register('t3', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('t3');
    TenantQuotaEnforcer.release('t3');
    expect(() => TenantQuotaEnforcer.acquireSync('t3', 0)).not.toThrow();
  });
});

describe('TenantQuotaEnforcer.updateCap', () => {
  it('increases cap on tier upgrade', () => {
    TenantQuotaEnforcer.register('t4', 'basic'); // cap 10
    TenantQuotaEnforcer.updateCap('t4', 'premium'); // cap 20
    for (let i = 0; i < 20; i++) TenantQuotaEnforcer.acquireSync('t4');
    expect(() => TenantQuotaEnforcer.acquireSync('t4', 0)).toThrow(ServiceUnavailableException);
  });
});

describe('TenantQuotaEnforcer.deregister', () => {
  it('removes slot, subsequent acquire passes through', () => {
    TenantQuotaEnforcer.register('t5', 'basic'); // cap 10
    for (let i = 0; i < 10; i++) TenantQuotaEnforcer.acquireSync('t5');
    TenantQuotaEnforcer.deregister('t5');
    expect(() => TenantQuotaEnforcer.acquireSync('t5', 0)).not.toThrow();
  });
});
