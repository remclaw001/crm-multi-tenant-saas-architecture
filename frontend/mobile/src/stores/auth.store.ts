import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

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
  isLoading: boolean;
  setAuth: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  token: null,
  user: null,
  tenantId: null,
  isLoading: true,

  setAuth: async (token, user) => {
    // Persist token in device secure storage (Keychain/Keystore)
    await SecureStore.setItemAsync('crm_token', token);
    await SecureStore.setItemAsync('crm_user', JSON.stringify(user));
    set({ token, user, tenantId: user.tenantId });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('crm_token');
    await SecureStore.deleteItemAsync('crm_user');
    set({ token: null, user: null, tenantId: null });
  },

  restoreSession: async () => {
    try {
      const token = await SecureStore.getItemAsync('crm_token');
      const userRaw = await SecureStore.getItemAsync('crm_user');
      if (token && userRaw) {
        const user = JSON.parse(userRaw) as User;
        set({ token, user, tenantId: user.tenantId, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
