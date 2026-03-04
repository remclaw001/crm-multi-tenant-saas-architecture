// frontend/web/src/stores/auth.store.ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  tenantId: string | null;
  tenantName: string | null;
  userName: string | null;
  userEmail: string | null;
  setAuth: (payload: {
    token: string;
    tenantId: string;
    tenantName: string;
    userName: string;
    userEmail: string;
  }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      tenantId: null,
      tenantName: null,
      userName: null,
      userEmail: null,
      setAuth: ({ token, tenantId, tenantName, userName, userEmail }) =>
        set({ token, tenantId, tenantName, userName, userEmail }),
      logout: () =>
        set({ token: null, tenantId: null, tenantName: null, userName: null, userEmail: null }),
    }),
    {
      name: 'crm-web-auth',
      partialize: (s) => ({
        token: s.token,
        tenantId: s.tenantId,
        tenantName: s.tenantName,
        userName: s.userName,
        userEmail: s.userEmail,
      }),
    },
  ),
);
