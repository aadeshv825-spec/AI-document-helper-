import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, UsageStats, PlanTier, AdminUserItem } from '../types';
import { logger } from '../utils/logger';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  usage: UsageStats;
  isLoading: boolean;
  isLimitReached: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  demoLogin: () => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; requiresConfig?: boolean; error?: string }>;
  demoGoogleLogin: () => Promise<{ success: boolean; error?: string }>;
  getGoogleOAuthStatus: () => Promise<{ configured: boolean; clientId?: string | null }>;
  logout: () => Promise<void>;
  updateProfile: (name: string, preferredLanguage?: string) => Promise<{ success: boolean; error?: string }>;
  updatePlan: (plan: PlanTier) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
  refreshUsage: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
  fetchAdminUsers: () => Promise<{ success: boolean; users?: AdminUserItem[]; error?: string }>;
  updateUserPlanByAdmin: (userId: string, plan: PlanTier) => Promise<{ success: boolean; message?: string; error?: string; user?: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'ai_doc_auth_token';
const CLIENT_ID_KEY = 'ai_doc_client_id';

function getOrCreateClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `cid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

const DEFAULT_USAGE: UsageStats = {
  dailyUsed: 0,
  dailyLimit: 5,
  dateString: new Date().toISOString().split('T')[0],
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [usage, setUsage] = useState<UsageStats>(DEFAULT_USAGE);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'x-client-id': getOrCreateClientId(),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  // Check auth and usage on mount or when token changes
  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/auth/me', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
        if (data.usage) {
          setUsage(data.usage);
        }
      } else {
        // If token expired or invalid, clear local token
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
      }
    } catch (err) {
      logger.error('Failed to verify user session', err);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/user/usage', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.usage) {
          setUsage(data.usage);
        }
      }
    } catch (err) {
      logger.error('Failed to refresh usage stats', err);
    }
  }, [getAuthHeaders]);

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Login failed.' };
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      if (data.usage) setUsage(data.usage);
      logger.info('User signed in successfully', { email: data.user.email });
      return { success: true };
    } catch (err: any) {
      logger.error('Login network error', err);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const register = async (name: string, email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Registration failed.' };
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      if (data.usage) setUsage(data.usage);
      logger.info('User account registered', { email: data.user.email });
      return { success: true };
    } catch (err: any) {
      logger.error('Registration network error', err);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const demoLogin = async () => {
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Demo login failed.' };
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      if (data.usage) setUsage(data.usage);
      logger.info('Demo user signed in');
      return { success: true };
    } catch (err: any) {
      logger.error('Demo login error', err);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const getGoogleOAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/google/status');
      if (res.ok) {
        return await res.json();
      }
      return { configured: false };
    } catch {
      return { configured: false };
    }
  };

  const demoGoogleLogin = async () => {
    try {
      const res = await fetch('/api/auth/google/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Google demo login failed.' };
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
      if (data.usage) setUsage(data.usage);
      logger.info('Google demo user signed in');
      return { success: true };
    } catch (err: any) {
      logger.error('Google demo login error', err);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const signInWithGoogle = async (): Promise<{ success: boolean; requiresConfig?: boolean; error?: string }> => {
    try {
      const status = await getGoogleOAuthStatus();
      if (!status.configured) {
        return {
          success: false,
          requiresConfig: true,
          error: 'Google OAuth is not configured yet. Server is waiting for GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET credentials.',
        };
      }

      const res = await fetch('/api/auth/google/url');
      const data = await res.json();
      if (!res.ok || !data.url) {
        return {
          success: false,
          requiresConfig: !data.configured,
          error: data.error || 'Could not initiate Google authentication.',
        };
      }

      // Open popup
      const width = 500;
      const height = 650;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        data.url,
        'google_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`
      );

      return new Promise((resolve) => {
        const handleMessage = (event: MessageEvent) => {
          if (event.data && event.data.type === 'GOOGLE_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            const { token: receivedToken, user: receivedUser, usage: receivedUsage } = event.data;
            if (receivedToken) {
              localStorage.setItem(TOKEN_KEY, receivedToken);
              setToken(receivedToken);
            }
            if (receivedUser) setUser(receivedUser);
            if (receivedUsage) setUsage(receivedUsage);
            logger.info('Google OAuth sign in successful', { email: receivedUser?.email });
            resolve({ success: true });
          } else if (event.data && event.data.type === 'GOOGLE_AUTH_ERROR') {
            window.removeEventListener('message', handleMessage);
            resolve({ success: false, error: event.data.error || 'Google authentication was cancelled.' });
          }
        };

        window.addEventListener('message', handleMessage);

        // Check if popup closed by user
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', handleMessage);
            resolve({ success: false, error: 'Sign-in window closed.' });
          }
        }, 1000);
      });
    } catch (err: any) {
      logger.error('Google sign in error', err);
      return { success: false, error: 'Failed to initiate Google sign in.' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch (err) {
      logger.error('Logout error', err);
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
      refreshUsage();
      logger.info('User logged out');
    }
  };

  const updateProfile = async (name: string, preferredLanguage?: string) => {
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name, preferredLanguage }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Update failed.' };
      }
      setUser(data.user);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: 'Network error.' };
    }
  };

  const updatePlan = async (plan: PlanTier) => {
    try {
      const res = await fetch('/api/user/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to update plan.' };
      }
      if (data.user) setUser(data.user);
      if (data.usage) setUsage(data.usage);
      logger.info('User plan updated', { plan });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: 'Network error.' };
    }
  };

  const deleteAccount = async () => {
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json();
        return { success: false, error: data.error || 'Failed to delete account.' };
      }
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
      refreshUsage();
      logger.info('User account permanently deleted');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: 'Network error.' };
    }
  };

  const isAdmin = !!(user?.isAdmin || user?.email?.toLowerCase() === 'aadeshv825@gmail.com');

  const fetchAdminUsers = async (): Promise<{ success: boolean; users?: AdminUserItem[]; error?: string }> => {
    try {
      const res = await fetch('/api/admin/users', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to load users.' };
      }
      return { success: true, users: data.users || [] };
    } catch (err: any) {
      return { success: false, error: 'Network error loading users.' };
    }
  };

  const updateUserPlanByAdmin = async (
    userId: string,
    plan: PlanTier
  ): Promise<{ success: boolean; message?: string; error?: string; user?: any }> => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to update user plan.' };
      }

      // If the admin modified their own plan, sync local user state immediately
      if (user && user.id === userId && data.user) {
        setUser(data.user);
        if (data.usage) setUsage(data.usage);
      }

      return { success: true, message: data.message, user: data.user };
    } catch (err: any) {
      return { success: false, error: 'Network error updating user plan.' };
    }
  };

  const isPro = user?.plan === 'pro';
  const isLimitReached = !isPro && usage.dailyUsed >= usage.dailyLimit;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        usage,
        isLoading,
        isLimitReached,
        isAdmin,
        login,
        register,
        demoLogin,
        signInWithGoogle,
        demoGoogleLogin,
        getGoogleOAuthStatus,
        logout,
        updateProfile,
        updatePlan,
        deleteAccount,
        refreshUsage,
        getAuthHeaders,
        fetchAdminUsers,
        updateUserPlanByAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
