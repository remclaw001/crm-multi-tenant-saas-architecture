'use client';

import { create } from 'zustand';

interface ContactStoreState {
  selectedContactId: string | null;
  searchQuery: string;
  statusFilter: string | null;
  setSelectedContact: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setStatusFilter: (status: string | null) => void;
}

export const useContactStore = create<ContactStoreState>()((set) => ({
  selectedContactId: null,
  searchQuery: '',
  statusFilter: null,
  setSelectedContact: (id) => set({ selectedContactId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setStatusFilter: (status) => set({ statusFilter: status }),
}));
