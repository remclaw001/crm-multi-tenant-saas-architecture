'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  fullName: string;
  tenantId: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  tenantId: string | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      tenantId: null,
      setAuth: (token, user) => set({ token, user, tenantId: user.tenantId }),
      logout: () => set({ token: null, user: null, tenantId: null }),
    }),
    {
      name: 'crm-web-auth',
      partialize: (state) => ({ token: state.token, user: state.user, tenantId: state.tenantId }),
    },
  ),
);
