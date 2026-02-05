/**
 * Auth Store
 * Manages authentication state with Zustand + better-auth
 */

import { create } from 'zustand';
import { authClient } from '../lib/auth-client';
import type { User } from '../types';

interface UpdateProfileData {
  name?: string;
  username?: string;
  avatar?: string;
}

interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  updateProfile: (data: UpdateProfileData) => Promise<void>;
  changePassword: (data: ChangePasswordData) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  setUser: (user: User | null) => void;
}

/**
 * Convert better-auth user to our User type
 */
function mapBetterAuthUser(baUser: any): User {
  return {
    id: baUser.id,
    email: baUser.email,
    username: baUser.email?.split('@')[0] || baUser.name || 'user',
    name: baUser.name || baUser.email?.split('@')[0] || 'User',
    avatar: baUser.image || null,
    role: baUser.role || 'user',
    provider: 'local',
  };
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  
  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await authClient.signIn.email({
        email,
        password,
      });
      
      if (error) {
        throw new Error(error.message || 'Login failed');
      }
      
      if (data?.user) {
        set({
          user: mapBetterAuthUser(data.user),
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        throw new Error('No user returned from login');
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },
  
  register: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const { data: result, error } = await authClient.signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
      });
      
      if (error) {
        throw new Error(error.message || 'Registration failed');
      }
      
      if (result?.user) {
        set({
          user: mapBetterAuthUser(result.user),
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        throw new Error('No user returned from registration');
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Registration failed',
        isLoading: false,
      });
      throw error;
    }
  },
  
  logout: async () => {
    try {
      await authClient.signOut();
    } finally {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
  
  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const { data: session, error } = await authClient.getSession();
      
      if (error || !session?.user) {
        set({ 
          user: null, 
          isAuthenticated: false, 
          isLoading: false 
        });
        return;
      }
      
      set({
        user: mapBetterAuthUser(session.user),
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
  
  clearError: () => set({ error: null }),
  
  setUser: (user) => set({ 
    user, 
    isAuthenticated: !!user 
  }),
  
  updateProfile: async (data) => {
    set({ isLoading: true, error: null });
    try {
      // Use better-auth's update user endpoint
      const { error } = await authClient.updateUser({
        name: data.name,
        image: data.avatar,
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to update profile');
      }
      
      const currentUser = get().user;
      if (currentUser) {
        set({
          user: {
            ...currentUser,
            name: data.name ?? currentUser.name,
            username: data.username ?? currentUser.username,
            avatar: data.avatar ?? currentUser.avatar,
          },
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update profile',
        isLoading: false,
      });
      throw error;
    }
  },
  
  changePassword: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await authClient.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to change password');
      }
      
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to change password',
        isLoading: false,
      });
      throw error;
    }
  },
  
  deleteAccount: async (password) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await authClient.deleteUser({
        password,
      });
      
      if (error) {
        throw new Error(error.message || 'Failed to delete account');
      }
      
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete account',
        isLoading: false,
      });
      throw error;
    }
  },
}));

/**
 * Hook to use better-auth's reactive session
 * This provides real-time session updates
 */
export function useBetterAuthSession() {
  return authClient.useSession();
}
