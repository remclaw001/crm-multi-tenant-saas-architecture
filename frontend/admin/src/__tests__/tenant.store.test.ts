import { describe, it, expect, beforeEach } from 'vitest';
import { useTenantStore } from '@/stores/tenant.store';
import { act } from '@testing-library/react';

beforeEach(() => {
  useTenantStore.setState({
    selectedTenantId: null,
    searchQuery: '',
    planFilter: null,
  });
});

describe('useTenantStore', () => {
  it('starts with null selectedTenantId', () => {
    expect(useTenantStore.getState().selectedTenantId).toBeNull();
  });

  it('starts with empty searchQuery', () => {
    expect(useTenantStore.getState().searchQuery).toBe('');
  });

  it('setSelectedTenant updates selectedTenantId', () => {
    act(() => {
      useTenantStore.getState().setSelectedTenant('tenant-1');
    });
    expect(useTenantStore.getState().selectedTenantId).toBe('tenant-1');
  });

  it('setSearchQuery updates searchQuery', () => {
    act(() => {
      useTenantStore.getState().setSearchQuery('acme');
    });
    expect(useTenantStore.getState().searchQuery).toBe('acme');
  });

  it('setPlanFilter updates planFilter', () => {
    act(() => {
      useTenantStore.getState().setPlanFilter('vip');
    });
    expect(useTenantStore.getState().planFilter).toBe('vip');
  });

  it('setSelectedTenant(null) clears selection', () => {
    act(() => {
      useTenantStore.getState().setSelectedTenant('tenant-1');
      useTenantStore.getState().setSelectedTenant(null);
    });
    expect(useTenantStore.getState().selectedTenantId).toBeNull();
  });

  it('independent updates do not interfere', () => {
    act(() => {
      useTenantStore.getState().setSearchQuery('beta');
      useTenantStore.getState().setPlanFilter('enterprise');
    });
    expect(useTenantStore.getState().searchQuery).toBe('beta');
    expect(useTenantStore.getState().planFilter).toBe('enterprise');
    expect(useTenantStore.getState().selectedTenantId).toBeNull();
  });
});
