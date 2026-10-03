import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, UsageStats, PlanTier, AdminUserItem } from '../types';
import { logger } from '../utils/logger';
import { apiFetch } from '../utils/apiClient';
import { restorePlayPurchases } from '../utils/playBilling';
import {
  cancelNativeGoogleSignInTimeout,
  isNativeGoogleSignInAvailable,
  launchNativeGoogleSignIn,
} from '../utils/android';

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
  activateGooglePlayPurchase: (purchaseData: {
    purchaseToken: string;
    sku: string;
    orderId?: string;
    packageName?: string;
  }) => Promise<{ success: boolean; message?: string; error?: string }>;
  restoreGooglePlayPurchases: () => Promise<{ success: boolean; restored: boolean; message: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  connectionError: boolean;
  retryConnection: () => void;
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

const WEB_CLIENT_ID =
  '358349564336-v9fq2to3b94q8482en0pt9f3b58scfgs.apps.googleusercontent.com';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [usage, setUsage] = useState<UsageStats>(DEFAULT_USAGE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // True when a saved session exists but the server could not be
  // reached, so the user is not wrongly sent to the login screen.
  const [connectionError, setConnectionError] = useState<boolean>(false);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'x-client-id': getOrCreateClientId(),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }, [token]);

  const checkAuth = useCallback(async () => {
    setIsLoading(true);

    try {
      const res = await apiFetch('/api/auth/me', {
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        const data = await res.json();

        setConnectionError(false);

        if (data.authenticated && data.user) {
          setUser(data.user);
        } else {
          // The saved session is no longer valid on the server.
          if (token) {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
          }

          setUser(null);
        }

        if (data.usage) {
          setUsage(data.usage);
        }
      } else if (res.status === 401) {
        setConnectionError(false);
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } else if (token) {
        // Server error: keep the saved session and offer a retry.
        setConnectionError(true);
      }
    } catch (err) {
      logger.error('Failed to verify user session', err);

      if (token) {
        setConnectionError(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders, token]);

  // Verify the saved session once on startup. Sign-in flows set the
  // user directly, so re-checking on every token change is unnecessary.
  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryConnection = useCallback(() => {
    checkAuth();
  }, [checkAuth]);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await apiFetch('/api/user/usage', {
        headers: getAuthHeaders(),
      });

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
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Login failed.',
        };
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);

      if (data.usage) {
        setUsage(data.usage);
      }

      logger.info('User signed in successfully', {
        email: data.user.email,
      });

      return { success: true };
    } catch (err) {
      logger.error('Login network error', err);

      return {
        success: false,
        error: 'Network error. Please try again.',
      };
    }
  };

  const register = async (name: string, email: string, password: string) => {
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          email,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Registration failed.',
        };
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);

      if (data.usage) {
        setUsage(data.usage);
      }

      logger.info('User account registered', {
        email: data.user.email,
      });

      return { success: true };
    } catch (err) {
      logger.error('Registration network error', err);

      return {
        success: false,
        error: 'Network error. Please try again.',
      };
    }
  };

  const getGoogleOAuthStatus = async () => {
    try {
      const res = await apiFetch('/api/auth/google/status');

      if (res.ok) {
        return await res.json();
      }

      return { configured: false };
    } catch {
      return { configured: false };
    }
  };

  const signInWithGoogle = async (): Promise<{
    success: boolean;
    requiresConfig?: boolean;
    error?: string;
  }> => {
    try {
      if (isNativeGoogleSignInAvailable()) {
        logger.info('Initiating Android Credential Manager Google Sign-In');

        return await new Promise((resolve) => {
          let finished = false;
          let processingSuccess = false;

          const cleanup = () => {
            cancelNativeGoogleSignInTimeout();

            window.removeEventListener(
              'onNativeGoogleSignInSuccess',
              handleSuccess as EventListener
            );

            window.removeEventListener(
              'onNativeGoogleSignInError',
              handleError as EventListener
            );
          };

          const finish = (result: {
            success: boolean;
            error?: string;
          }) => {
            if (finished) return;

            finished = true;
            cleanup();
            resolve(result);
          };

          const handleSuccess = async (event: any) => {
            if (finished || processingSuccess) return;

            processingSuccess = true;

            const payload = event.detail || event;

            if (!payload?.idToken) {
              processingSuccess = false;

              finish({
                success: false,
                error: 'Google did not return a valid ID token.',
              });

              return;
            }

            try {
              const res = await apiFetch('/api/auth/google/native', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                  idToken: payload.idToken,
                  email: payload.email,
                  displayName: payload.displayName,
                  photoUrl: payload.photoUrl,
                }),
              });

              const data = await res.json();

              if (!res.ok || !data.token) {
                finish({
                  success: false,
                  error:
                    data.error ||
                    'Failed to authenticate Google account with server.',
                });
                return;
              }

              localStorage.setItem(TOKEN_KEY, data.token);
              setToken(data.token);

              if (data.user) {
                setUser(data.user);
              }

              if (data.usage) {
                setUsage(data.usage);
              }

              logger.info('Android Google Sign-In successful', {
                email: data.user?.email,
              });

              finish({ success: true });
            } catch (err) {
              logger.error(
                'Android Google auth server exchange failed',
                err
              );

              finish({
                success: false,
                error: 'Network error communicating with server.',
              });
            }
          };

          const handleError = (event: any) => {
            if (finished) return;

            const errorDetail = event.detail || event;

            if (errorDetail?.code === 'USER_CANCELLED') {
              finish({
                success: false,
                error: 'Google account selection was cancelled.',
              });
            } else {
              finish({
                success: false,
                error:
                  errorDetail?.error ||
                  'Failed to complete Google Sign-In.',
              });
            }
          };

          window.addEventListener(
            'onNativeGoogleSignInSuccess',
            handleSuccess as EventListener
          );

          window.addEventListener(
            'onNativeGoogleSignInError',
            handleError as EventListener
          );

          const launched = launchNativeGoogleSignIn(WEB_CLIENT_ID);

          if (!launched) {
            finish({
              success: false,
              error: 'Native Google Sign-In is unavailable.',
            });
          }
        });
      }

      await new Promise<void>((resolve, reject) => {
        if (
          typeof (window as any).google?.accounts?.id !== 'undefined'
        ) {
          resolve();
          return;
        }

        const existingScript =
          document.getElementById('google-gsi-client');

        if (existingScript) {
          existingScript.addEventListener('load', () => resolve());
          existingScript.addEventListener('error', () =>
            reject(
              new Error(
                'Failed to load Google Identity Services library.'
              )
            )
          );
          return;
        }

        const script = document.createElement('script');

        script.id = 'google-gsi-client';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;

        script.onload = () => resolve();

        script.onerror = () =>
          reject(
            new Error(
              'Failed to load Google Identity Services library.'
            )
          );

        document.head.appendChild(script);
      });

      return new Promise((resolve) => {
        const googleId = (window as any).google?.accounts?.id;

        if (!googleId) {
          resolve({
            success: false,
            error:
              'Google Identity Services library is unavailable.',
          });
          return;
        }

        let isResolved = false;
        let fallbackOverlay: HTMLDivElement | null = null;

        const removeFallbackOverlay = () => {
          if (fallbackOverlay) {
            fallbackOverlay.remove();
            fallbackOverlay = null;
          }
        };

        // One Tap can be suppressed by the browser (cooldown after a
        // dismissal, blocked third-party cookies, etc.). In that case show
        // Google's standard sign-in button, which is not subject to those
        // limits, instead of failing.
        const showButtonFallback = (): boolean => {
          if (typeof googleId.renderButton !== 'function') {
            return false;
          }

          removeFallbackOverlay();

          const overlay = document.createElement('div');
          overlay.setAttribute('role', 'dialog');
          overlay.setAttribute('aria-modal', 'true');
          overlay.setAttribute('aria-label', 'Sign in with Google');
          overlay.style.cssText =
            'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,0.8);padding:16px;';

          const card = document.createElement('div');
          card.style.cssText =
            'background:#0f172a;border:1px solid #334155;border-radius:16px;padding:20px;max-width:340px;width:100%;text-align:center;font-family:inherit;';

          const title = document.createElement('p');
          title.textContent = 'Continue with your Google account';
          title.style.cssText =
            'color:#e2e8f0;font-size:14px;font-weight:600;margin:0 0 14px;';

          const buttonHost = document.createElement('div');
          buttonHost.style.cssText =
            'display:flex;justify-content:center;min-height:44px;';

          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = 'Cancel';
          cancel.style.cssText =
            'margin-top:14px;background:none;border:0;color:#94a3b8;font-size:13px;cursor:pointer;padding:6px 12px;';
          cancel.onclick = () => {
            if (isResolved) return;

            isResolved = true;
            removeFallbackOverlay();

            resolve({
              success: false,
              error: 'Google account selection was cancelled.',
            });
          };

          card.appendChild(title);
          card.appendChild(buttonHost);
          card.appendChild(cancel);
          overlay.appendChild(card);
          document.body.appendChild(overlay);
          fallbackOverlay = overlay;

          try {
            googleId.renderButton(buttonHost, {
              type: 'standard',
              theme: 'outline',
              size: 'large',
              text: 'continue_with',
              shape: 'pill',
              width: 280,
            });
          } catch (renderErr) {
            logger.error('Failed to render Google button', renderErr);
            removeFallbackOverlay();
            return false;
          }

          return true;
        };

        googleId.initialize({
          client_id: WEB_CLIENT_ID,

          callback: async (response: { credential?: string }) => {
            if (isResolved) return;

            isResolved = true;
            removeFallbackOverlay();

            if (!response?.credential) {
              resolve({
                success: false,
                error: 'No Google credential returned.',
              });
              return;
            }

            try {
              const verifyRes = await apiFetch(
                '/api/auth/google/native',
                {
                  method: 'POST',
                  headers: getAuthHeaders(),
                  body: JSON.stringify({
                    idToken: response.credential,
                  }),
                }
              );

              const verifyData = await verifyRes.json();

              if (!verifyRes.ok || !verifyData.token) {
                resolve({
                  success: false,
                  error:
                    verifyData.error ||
                    'Failed to authenticate Google account with server.',
                });
                return;
              }

              localStorage.setItem(
                TOKEN_KEY,
                verifyData.token
              );

              setToken(verifyData.token);

              if (verifyData.user) {
                setUser(verifyData.user);
              }

              if (verifyData.usage) {
                setUsage(verifyData.usage);
              }

              resolve({ success: true });
            } catch (err) {
              logger.error(
                'Google token verification failed',
                err
              );

              resolve({
                success: false,
                error:
                  'Network error communicating with server.',
              });
            }
          },

          auto_select: false,
          cancel_on_tap_outside: true,
        });

        googleId.prompt((notification: any) => {
          if (notification.isNotDisplayed()) {
            if (!isResolved && !fallbackOverlay) {
              if (!showButtonFallback()) {
                isResolved = true;

                resolve({
                  success: false,
                  error:
                    'Google Sign-In could not be displayed in this browser. Please allow pop-ups and third-party sign-in, or use email and password.',
                });
              }
            }
          } else if (notification.isSkippedMoment()) {
            if (!isResolved && !fallbackOverlay) {
              isResolved = true;

              resolve({
                success: false,
                error: 'Google Sign-In was dismissed.',
              });
            }
          } else if (notification.isDismissedMoment()) {
            if (
              !isResolved &&
              !fallbackOverlay &&
              notification.getDismissedReason() !==
                'credential_returned'
            ) {
              isResolved = true;

              resolve({
                success: false,
                error:
                  'Google account selection was cancelled.',
              });
            }
          }
        });
      });
    } catch (err) {
      logger.error('Google sign in error', err);

      return {
        success: false,
        error: 'Failed to initiate Google sign in.',
      };
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', {
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

  const updateProfile = async (
    name: string,
    preferredLanguage?: string
  ) => {
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          preferredLanguage,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Update failed.',
        };
      }

      setUser(data.user);

      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Network error.',
      };
    }
  };

  const updatePlan = async (plan: PlanTier) => {
    try {
      const res = await apiFetch('/api/user/plan', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error:
            data.error || 'Failed to update plan.',
        };
      }

      if (data.user) {
        setUser(data.user);
      }

      if (data.usage) {
        setUsage(data.usage);
      }

      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Network error.',
      };
    }
  };

  const deleteAccount = async () => {
    try {
      const res = await apiFetch('/api/auth/account', {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();

        return {
          success: false,
          error:
            data.error ||
            'Failed to delete account.',
        };
      }

      // Remove this account's documents cached on this device.
      try {
        if (user?.id) {
          localStorage.removeItem(`ai_doc_user_${user.id}_history`);
        }
      } catch {
        // ignore
      }

      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);

      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Network error.',
      };
    }
  };

  // Admin status comes only from the server, which applies the owner
  // rule after verifying the account.
  const isAdmin = Boolean(user?.isAdmin);

  const requestPasswordReset = async (email: string) => {
    try {
      const res = await apiFetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Could not request a password reset.',
        };
      }

      return {
        success: true,
        message: data.message,
      };
    } catch {
      return {
        success: false,
        error: 'Network error. Please try again.',
      };
    }
  };

  const changePassword = async (
    currentPassword: string,
    newPassword: string
  ) => {
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Failed to change password.',
        };
      }

      // Other sessions were revoked; keep this device signed in.
      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
      }

      if (data.user) {
        setUser(data.user);
      }

      return {
        success: true,
        message: data.message,
      };
    } catch {
      return {
        success: false,
        error: 'Network error. Please try again.',
      };
    }
  };

  const fetchAdminUsers = async () => {
    try {
      const res = await apiFetch('/api/admin/users', {
        headers: getAuthHeaders(),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error:
            data.error || 'Failed to load users.',
        };
      }

      return {
        success: true,
        users: data.users || [],
      };
    } catch {
      return {
        success: false,
        error: 'Network error loading users.',
      };
    }
  };

  const updateUserPlanByAdmin = async (
    userId: string,
    plan: PlanTier
  ) => {
    try {
      const res = await apiFetch(
        `/api/admin/users/${userId}/plan`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ plan }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error:
            data.error ||
            'Failed to update user plan.',
        };
      }

      if (
        user &&
        user.id === userId &&
        data.user
      ) {
        setUser(data.user);

        if (data.usage) {
          setUsage(data.usage);
        }
      }

      return {
        success: true,
        message: data.message,
        user: data.user,
      };
    } catch {
      return {
        success: false,
        error:
          'Network error updating user plan.',
      };
    }
  };

  const activateGooglePlayPurchase = async (
    purchaseData: {
      purchaseToken: string;
      sku: string;
      orderId?: string;
      packageName?: string;
    }
  ) => {
    try {
      const res = await apiFetch(
        '/api/billing/google-play/verify-purchase',
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(purchaseData),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error:
            data.error ||
            'Failed to verify Google Play purchase.',
        };
      }

      if (data.user) {
        setUser(data.user);
      }

      if (data.usage) {
        setUsage(data.usage);
      }

      return {
        success: true,
        message: data.message,
      };
    } catch {
      return {
        success: false,
        error:
          'Network error communicating with billing verification server.',
      };
    }
  };

  const restoreGooglePlayPurchases = async () => {
    const result = await restorePlayPurchases(getAuthHeaders());

    if (!result.success) {
      return {
        success: false,
        restored: false,
        message: result.message || 'Failed to restore purchases.',
      };
    }

    if (result.restored && result.user) {
      setUser(result.user);
    }

    if (result.restored && result.usage) {
      setUsage(result.usage);
    }

    return {
      success: true,
      restored: result.restored,
      message: result.message,
    };
  };
  const isPro = user?.plan === 'pro';

  const isLimitReached =
    !isPro &&
    usage.dailyUsed >= usage.dailyLimit;

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
        requestPasswordReset,
        changePassword,
        connectionError,
        retryConnection,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth must be used within an AuthProvider'
    );
  }

  return context;
};
