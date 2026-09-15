import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ShieldCheck,
  Crown,
  Search,
  UserCheck,
  UserX,
  Sparkles,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Mail,
  User,
  ExternalLink,
} from 'lucide-react';
import { AdminUserItem, PlanTier } from '../types';
import { useAuth } from '../context/AuthContext';

interface AdminUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminUsersModal: React.FC<AdminUsersModalProps> = ({ isOpen, onClose }) => {
  const { user: currentUser, getAuthHeaders, refreshUsage, updatePlan } = useAuth();
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'pro'>('all');
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch users from server on open
  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setUsers(data.users);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setNotification({
          type: 'error',
          message: err.error || 'Failed to load users list. Admin privileges required.',
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: 'Network error while retrieving user accounts.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    } else {
      setNotification(null);
      setSearchQuery('');
    }
  }, [isOpen]);

  const handleTogglePlan = async (targetUser: AdminUserItem) => {
    const newPlan: PlanTier = targetUser.plan === 'pro' ? 'free' : 'pro';
    setProcessingUserId(targetUser.id);
    setNotification(null);

    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ plan: newPlan }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update plan status.');
      }

      // Update state locally
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, plan: newPlan } : u))
      );

      // If owner modified their own account, synchronize active session
      if (currentUser && currentUser.id === targetUser.id) {
        await refreshUsage();
      }

      setNotification({
        type: 'success',
        message: newPlan === 'pro'
          ? `✓ Pro access granted to ${targetUser.name} (${targetUser.email}). Unlimited AI access is now active!`
          : `✓ Pro access removed from ${targetUser.name} (${targetUser.email}). Account reverted to Free limits.`,
      });
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.message || 'Error occurred while updating user plan.',
      });
    } finally {
      setProcessingUserId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Plan filter
      if (planFilter !== 'all' && u.plan !== planFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = u.name.toLowerCase().includes(q);
        const matchEmail = u.email.toLowerCase().includes(q);
        if (!matchName && !matchEmail) return false;
      }
      return true;
    });
  }, [users, planFilter, searchQuery]);

  const totalUsers = users.length;
  const proCount = users.filter((u) => u.plan === 'pro').length;
  const freeCount = totalUsers - proCount;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-800 bg-gradient-to-r from-amber-500/10 via-slate-900 to-indigo-500/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 font-bold shadow-md">
                <ShieldCheck className="w-5 h-5 fill-current" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-slate-100">
                    Manage Users & Pro Access
                  </h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Owner Area
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Grant or revoke full Pro privileges securely in database
                </p>
              </div>
            </div>

            <button
              id="btn-close-admin-users"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Stats Strip */}
          <div className="grid grid-cols-3 gap-2 p-3 sm:p-4 bg-slate-900/80 border-b border-slate-800 text-xs shrink-0">
            <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-center">
              <span className="text-slate-400 block text-[11px]">Total Accounts</span>
              <span className="text-base sm:text-lg font-bold text-slate-100">{totalUsers}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-center">
              <span className="text-amber-300/80 block text-[11px] flex items-center justify-center gap-1">
                <Crown className="w-3 h-3 fill-amber-400 text-amber-400 inline" /> Pro Members
              </span>
              <span className="text-base sm:text-lg font-bold text-amber-300">{proCount}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-center">
              <span className="text-slate-400 block text-[11px]">Free Tier</span>
              <span className="text-base sm:text-lg font-bold text-slate-300">{freeCount}</span>
            </div>
          </div>

          {/* Notification Banner */}
          {notification && (
            <div
              className={`p-3 text-xs flex items-start gap-2 border-b shrink-0 ${
                notification.type === 'success'
                  ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-200'
                  : 'bg-red-950/70 border-red-800/60 text-red-200'
              }`}
            >
              {notification.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 font-medium">{notification.message}</div>
              <button
                onClick={() => setNotification(null)}
                className="text-slate-400 hover:text-slate-200 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Controls: Search & Plan Filter */}
          <div className="p-3 sm:p-4 border-b border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search user by name or email..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-800/80 border border-slate-700 text-xs rounded-xl text-slate-200 placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <div className="bg-slate-800/80 p-1 rounded-xl border border-slate-700/80 flex items-center text-xs">
                <button
                  onClick={() => setPlanFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    planFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({totalUsers})
                </button>
                <button
                  onClick={() => setPlanFilter('pro')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 ${
                    planFilter === 'pro'
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-amber-300'
                  }`}
                >
                  <Crown className="w-3 h-3 fill-current" /> Pro ({proCount})
                </button>
                <button
                  onClick={() => setPlanFilter('free')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    planFilter === 'free'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Free ({freeCount})
                </button>
              </div>

              <button
                onClick={fetchUsers}
                disabled={isLoading}
                title="Refresh user records"
                className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* User Cards List */}
          <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-2.5">
            {isLoading && users.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                <span>Loading registered user accounts...</span>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs bg-slate-800/20 border border-slate-800 rounded-2xl p-6">
                <User className="w-8 h-8 mx-auto text-slate-500 mb-2" />
                <p className="font-semibold text-slate-300">No users found</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  {searchQuery ? 'Try adjusting your search terms.' : 'No registered users match this filter.'}
                </p>
              </div>
            ) : (
              filteredUsers.map((item) => {
                const isItemPro = item.plan === 'pro';
                const isProcessing = processingUserId === item.id;
                const isCurrentUser = currentUser?.id === item.id;
                const isOwnerAccount = item.isAdmin || item.email.toLowerCase() === 'aadeshv825@gmail.com';
                const joinDate = new Date(item.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });

                return (
                  <div
                    key={item.id}
                    className={`p-3 sm:p-3.5 rounded-xl border transition-all ${
                      isItemPro
                        ? 'bg-slate-800/80 border-amber-500/40 hover:border-amber-500/60'
                        : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
                    } flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar */}
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 border ${
                          isItemPro
                            ? 'bg-gradient-to-br from-amber-500/30 to-amber-600/20 border-amber-500/50 text-amber-300'
                            : 'bg-slate-700/40 border-slate-600/50 text-slate-300'
                        }`}
                      >
                        {item.name ? item.name.charAt(0).toUpperCase() : 'U'}
                      </div>

                      {/* User Info */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-semibold text-slate-100 truncate">
                            {item.name || 'Unnamed User'}
                          </span>

                          {isOwnerAccount && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-300 border border-amber-500/40">
                              Admin / Owner
                            </span>
                          )}

                          {isCurrentUser && (
                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              You
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="w-3 h-3 text-slate-500" />
                            {item.email}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1 shrink-0">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            Joined {joinDate}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right side: Plan Badge & Toggle Button */}
                    <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0 w-full sm:w-auto justify-between sm:justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/40">
                      {/* Current Status Pill */}
                      <div>
                        {isItemPro ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <Crown className="w-3 h-3 fill-amber-400 text-amber-400" />
                            Pro Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-700/60 text-slate-300 border border-slate-600/40">
                            Free Tier
                          </span>
                        )}
                      </div>

                      {/* Action Button: Give Pro / Remove Pro */}
                      <button
                        id={`btn-toggle-pro-${item.id}`}
                        disabled={isProcessing}
                        onClick={() => handleTogglePlan(item)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 shadow-sm ${
                          isItemPro
                            ? 'bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-800/60'
                            : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold shadow-amber-500/20'
                        }`}
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Updating...</span>
                          </>
                        ) : isItemPro ? (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            <span>Remove Pro</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 fill-current" />
                            <span>Give Pro</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400 shrink-0">
            <span className="text-[11px] text-slate-500">
              Changes take effect immediately across all client sessions.
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
