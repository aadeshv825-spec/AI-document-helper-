import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  User,
  Mail,
  Crown,
  LogOut,
  Trash2,
  Calendar,
  Sparkles,
  AlertTriangle,
  Loader2,
  Save,
  Check,
  Users,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPro: () => void;
  onOpenAdminUsers?: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  onOpenPro,
  onOpenAdminUsers,
}) => {
  const { user, usage, logout, updateProfile, deleteAccount } = useAuth();

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(user?.name || '');
  const [langVal, setLangVal] = useState(user?.preferredLanguage || 'English');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  if (!isOpen || !user) return null;

  const isPro = user.plan === 'pro';
  const memberSince = new Date(user.createdAt).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleSaveProfile = async () => {
    setSaveLoading(true);
    const res = await updateProfile(nameVal, langVal);
    setSaveLoading(false);
    if (res.success) {
      setSaveSuccess(true);
      setEditingName(false);
      setTimeout(() => setSaveSuccess(false), 2500);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    await deleteAccount();
    setDeleteLoading(false);
    onClose();
  };

  const usagePercent = isPro ? 100 : Math.min(100, Math.round((usage.dailyUsed / usage.dailyLimit) * 100));

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-100">User Profile</h2>
                <p className="text-[11px] text-slate-400">{user.email}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            {/* Membership & Plan Status */}
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">Current Plan:</span>
                  {isPro ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      <Crown className="w-3 h-3 fill-amber-400 text-amber-400" />
                      Pro Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-200">
                      Free Tier
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Member since {memberSince}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenPro();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 shrink-0 ${
                  isPro
                    ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm'
                }`}
              >
                {isPro ? 'Manage Plan' : 'Upgrade to Pro'}
              </button>
            </div>

            {/* Owner & Administrator Controls */}
            {(user.isAdmin || user.email.toLowerCase() === 'aadeshv825@gmail.com') && (
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-950/40 to-slate-800/60 border border-amber-500/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                        Owner & Admin Portal
                        <span className="text-[9px] uppercase px-1.5 py-0.2 bg-amber-500/30 text-amber-300 font-bold rounded">
                          Admin
                        </span>
                      </h3>
                      <p className="text-[11px] text-amber-300/80">
                        View registered users and toggle Pro access
                      </p>
                    </div>
                  </div>

                  <button
                    id="btn-admin-manage-users-profile"
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAdminUsers?.();
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-sm shrink-0 flex items-center gap-1.5"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Manage Users
                  </button>
                </div>
              </div>
            )}

            {/* Server-Side Daily AI Usage */}
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  Today's AI Usage (Server Tracked)
                </span>
                <span className="font-semibold text-slate-300">
                  {isPro ? (
                    <span className="text-emerald-400">Unlimited Actions</span>
                  ) : (
                    <span>
                      {usage.dailyUsed} / {usage.dailyLimit} actions used
                    </span>
                  )}
                </span>
              </div>

              {!isPro && (
                <>
                  <div className="w-full h-2 bg-slate-700/60 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        usagePercent >= 100
                          ? 'bg-red-500'
                          : usagePercent >= 60
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Resets every midnight</span>
                    {usage.dailyUsed >= usage.dailyLimit && (
                      <span className="text-amber-400 font-medium">Daily limit reached</span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Profile Information & Edit */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Account Details
                </h3>
                {!editingName ? (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Edit
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingName(false)}
                      className="text-xs text-slate-400 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={saveLoading}
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                    >
                      {saveLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="text-[11px] text-slate-400">Display Name</label>
                  {editingName ? (
                    <input
                      type="text"
                      value={nameVal}
                      onChange={(e) => setNameVal(e.target.value)}
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  ) : (
                    <p className="text-xs font-medium text-slate-200 mt-0.5">{user.name}</p>
                  )}
                </div>

                <div>
                  <label className="text-[11px] text-slate-400">Email Address</label>
                  <p className="text-xs font-medium text-slate-300 mt-0.5">{user.email}</p>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400">Preferred Language</label>
                  {editingName ? (
                    <select
                      value={langVal}
                      onChange={(e) => setLangVal(e.target.value)}
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      <option value="English">English</option>
                      <option value="Hindi">Hindi (हिंदी)</option>
                      <option value="Hinglish">Hinglish</option>
                      <option value="Marathi">Marathi (मराठी)</option>
                      <option value="Gujarati">Gujarati (ગુજરાતી)</option>
                    </select>
                  ) : (
                    <p className="text-xs font-medium text-slate-200 mt-0.5">{user.preferredLanguage || 'English'}</p>
                  )}
                </div>
              </div>

              {saveSuccess && (
                <div className="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Profile updated successfully.
                </div>
              )}
            </div>

            {/* Logout & Delete Area */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  onClose();
                }}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700/80 active:scale-[0.99] text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 border border-slate-700/50"
              >
                <LogOut className="w-4 h-4 text-slate-400" />
                Sign Out
              </button>

              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-1.5 text-red-400/80 hover:text-red-300 text-[11px] transition-colors flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete Account & All Documents
                </button>
              ) : (
                <div className="p-3 bg-red-950/40 border border-red-800/50 rounded-xl space-y-2">
                  <p className="text-xs text-red-300 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    Permanently delete account?
                  </p>
                  <p className="text-[11px] text-slate-400">
                    This will delete your profile, history, and all cloud-synced documents. This action cannot be undone.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleteLoading}
                      onClick={handleDeleteAccount}
                      className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      {deleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
