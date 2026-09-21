import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, UsageStats, PlanTier, AdminUserItem } from '../types';
import { logger } from '../utils/logger';
import { isNativeGoogleSignInAvailable, launchNativeGoogleSignIn } from '../utils/android';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  usage: UsageStats;
  isLoading: boolean;
  isLimitReached: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; requiresConfig?: boolean; error?: string }>;
  getGoogleOAuthStatus: () => Promise<{ configured: boolean; clientId?: string | null }>;
  logout: () => Promise<void>;
  updateProfile: (name: string, preferredLanguage?: string) => Promise<{ success: boolean; error?: string }>;
  updatePlan: (plan: PlanTier) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: () => Promise<{ success: boolean; error?: string }>;
  refreshUsage: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
  fetchAdminUsers: () => Promise<{ success: boolean; users?: AdminUserItem[]; error?: string }>;
  updateUserPlanByAdmin: (userId: string, plan: PlanTier) => Promise<{ success: boolean; message?: string; error?: string; user?: any }>;
  activateGooglePlayPurchase: (purchaseData: { purchaseToken: string; sku: string; orderId?: string; packageName?: string }) => Promise<{ success: boolean; message?: string; error?: string }>;
  restoreGooglePlayPurchases: () => Promise<{ success: boolean; restored: boolean; message: string }>;
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

  const signInWithGoogle = async (): Promise<{ success: boolean; requiresConfig?: boolean; error?: string }> => {
    try {
      // 1. Android Native Flow: Official Credential Manager Account Picker (No GOOGLE_CLIENT_SECRET required)
      if (isNativeGoogleSignInAvailable()) {
        logger.info('Initiating Android Credential Manager Google Sign-In');
        const launched = launchNativeGoogleSignIn('358349564336-v9fq2to3b94q8482en0pt9f3b58scfgs.apps.googleusercontent.com');
        if (launched) {
          return new Promise((resolve) => {
            const handleSuccess = async (event: any) => {
              cleanup();
              const payload = event.detail || event;
              try {
                const res = await fetch('/api/auth/google/native', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                  body: JSON.stringify({
                    idToken: payload.idToken,
                    email: payload.email,
                    displayName: payload.displayName,
                    photoUrl: payload.photoUrl,
                  }),
                });
                const data = await res.json();
                if (!res.ok || !data.token) {
                  resolve({ success: false, error: data.error || 'Failed to authenticate Google account with server.' });
                  return;
                }

                localStorage.setItem(TOKEN_KEY, data.token);
                setToken(data.token);
                if (data.user) setUser(data.user);
                if (data.usage) setUsage(data.usage);
                logger.info('Android Credential Manager Google sign in successful', { email: data.user?.email });
                resolve({ success: true });
              } catch (networkErr: any) {
                logger.error('Android Google auth server exchange failed', networkErr);
                resolve({ success: false, error: 'Network error communicating with server.' });
              }
            };

            const handleError = (event: any) => {
              cleanup();
              const errorDetail = event.detail || event;
              if (errorDetail?.code === 'USER_CANCELLED') {
                resolve({ success: false, error: 'Google account selection was cancelled.' });
              } else {
                resolve({ success: false, error: errorDetail?.error || 'Failed to complete Google Sign-In.' });
              }
            };

            const cleanup = () => {
              window.removeEventListener('onNativeGoogleSignInSuccess' as any, handleSuccess);
              window.removeEventListener('onNativeGoogleSignInError' as any, handleError);
              delete window.onNativeGoogleSignInSuccess;
              delete window.onNativeGoogleSignInError;
            };

            window.addEventListener('onNativeGoogleSignInSuccess' as any, handleSuccess);
            window.addEventListener('onNativeGoogleSignInError' as any, handleError);
            window.onNativeGoogleSignInSuccess = (data) => handleSuccess({ detail: data });
            window.onNativeGoogleSignInError = (data) => handleError({ detail: data });
          });
        }
      }

      // 2. Web Browser Fallback Flow: Google Identity Services (GSI) with configured public Web Client ID
      const webClientId = '358349564336-v9fq2to3b94q8482en0pt9f3b58scfgs.apps.googleusercontent.com';

      // Load Google Identity Services script dynamically if not yet available
      await new Promise<void>((resolve, reject) => {
        if (typeof (window as any).google?.accounts?.id !== 'undefined') {
          resolve();
          return;
        }
        const existingScript = document.getElementById('google-gsi-client');
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve());
          existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services library.')));
          return;
        }
        const script = document.createElement('script');
        script.id = 'google-gsi-client';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google Identity Services library.'));
        document.head.appendChild(script);
      });

      return new Promise((resolve) => {
        const googleId = (window as any).google?.accounts?.id;
        if (!googleId) {
          resolve({ success: false, error: 'Google Identity Services library is unavailable.' });
          return;
        }

        let isResolved = false;

        googleId.initialize({
          client_id: webClientId,
          callback: async (response: { credential?: string }) => {
            if (isResolved) return;
            isResolved = true;

            if (!response?.credential) {
              resolve({ success: false, error: 'No Google credential returned.' });
              return;
            }

            try {
              const verifyRes = await fetch('/api/auth/google/native', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ idToken: response.credential }),
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok || !verifyData.token) {
                resolve({ success: false, error: verifyData.error || 'Failed to authenticate Google account with server.' });
                return;
              }

              localStorage.setItem(TOKEN_KEY, verifyData.token);
              setToken(verifyData.token);
              if (verifyData.user) setUser(verifyData.user);
              if (verifyData.usage) setUsage(verifyData.usage);
              logger.info('Web Google Identity Services sign in successful', { email: verifyData.user?.email });
              resolve({ success: true });
            } catch (networkErr: any) {
              logger.error('Google token verification server exchange failed', networkErr);
              resolve({ success: false, error: 'Network error communicating with server.' });
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Prompt user account selector
        googleId.prompt((notification: any) => {
          if (notification.isNotDisplayed()) {
            logger.warn('Google One Tap not displayed:', notification.getNotDisplayedReason());
            if (!isResolved) {
              isResolved = true;
              resolve({
                success: false,
                error: `Google prompt could not be displayed (${notification.getNotDisplayedReason()}). If third-party cookies or popups are blocked, please enable them or test on Android.`,
              });
            }
          } else if (notification.isSkippedMoment()) {
            logger.warn('Google One Tap skipped:', notification.getSkippedReason());
            if (!isResolved) {
              isResolved = true;
              resolve({ success: false, error: 'Google Sign-In was dismissed.' });
            }
          } else if (notification.isDismissedMoment()) {
            logger.warn('Google One Tap dismissed:', notification.getDismissedReason());
            if (!isResolved && notification.getDismissedReason() !== 'credential_returned') {
              isResolved = true;
              resolve({ success: false, error: 'Google account selection was cancelled.' });
            }
          }
        });
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

  const activateGooglePlayPurchase = async (purchaseData: {
    purchaseToken: string;
    sku: string;
    orderId?: string;
    packageName?: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const res = await fetch('/api/billing/google-play/verify-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(purchaseData),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to verify Google Play purchase.' };
      }

      if (data.user) {
        setUser(data.user);
      }
      if (data.usage) {
        setUsage(data.usage);
      }
      logger.info('Google Play Pro subscription activated in AuthContext', { sku: purchaseData.sku });
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, error: 'Network error communicating with billing verification server.' };
    }
  };

  const restoreGooglePlayPurchases = async (): Promise<{ success: boolean; restored: boolean; message: string }> => {
    try {
      const res = await fetch('/api/billing/google-play/restore-purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, restored: false, message: data.error || 'Failed to restore purchases.' };
      }

      if (data.restored && data.user) {
        setUser(data.user);
      }
      if (data.restored && data.usage) {
        setUsage(data.usage);
      }
      return { success: true, restored: Boolean(data.restored), message: data.message };
    } catch (err: any) {
      return { success: false, restored: false, message: 'Network error restoring purchases.' };
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
        signInWithGoogle,
        getGoogleOAuthStatus,
        logout,
        updateProfile,
        updatePlan,
        deleteAccount,
        refreshUsage,
        getAuthHeaders,
        fetchAdminUsers,
        updateUserPlanByAdmin,
        activateGooglePlayPurchase,
        restoreGooglePlayPurchases,
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
