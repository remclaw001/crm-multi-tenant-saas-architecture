'use client';

import { create } from 'zustand';

interface TenantStoreState {
  selectedTenantId: string | null;
  searchQuery: string;
  planFilter: string | null;
  setSelectedTenant: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setPlanFilter: (plan: string | null) => void;
}

export const useTenantStore = create<TenantStoreState>()((set) => ({
  selectedTenantId: null,
  searchQuery: '',
  planFilter: null,
  setSelectedTenant: (id) => set({ selectedTenantId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setPlanFilter: (plan) => set({ planFilter: plan }),
}));
