import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Settings,
  Sun,
  Moon,
  Database,
  Trash,
  HelpCircle,
  Shield,
  FileText,
  Info,
  Smartphone,
  CheckCircle,
  ExternalLink,
  User,
  Sparkles,
  Download,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  historyCount: number;
  onClearLocalCache: () => void;
  onOpenAbout: () => void;
  onOpenHelp: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  onOpenOnboarding: () => void;
  onOpenProfile: () => void;
  onOpenAuth: () => void;
  onOpenAdminUsers?: () => void;
  installPrompt?: any;
  onInstallPwa?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  historyCount,
  onClearLocalCache,
  onOpenAbout,
  onOpenHelp,
  onOpenPrivacy,
  onOpenTerms,
  onOpenOnboarding,
  onOpenProfile,
  onOpenAuth,
  onOpenAdminUsers,
  installPrompt,
  onInstallPwa,
}) => {
  const { user } = useAuth();
  const [clearedNotice, setClearedNotice] = useState(false);

  if (!isOpen) return null;

  const isAdmin = Boolean(user?.isAdmin || user?.email?.toLowerCase() === 'aadeshv825@gmail.com');

  const handleClearCache = () => {
    onClearLocalCache();
    setClearedNotice(true);
    setTimeout(() => setClearedNotice(false), 2000);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                <Settings className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">App Settings</h2>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
            {/* Account Banner */}
            <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold shrink-0">
                  {user ? user.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-200 truncate">
                    {user ? user.name : 'Guest User'}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {user ? user.email : 'Sign in to sync across devices'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (user) {
                    onOpenProfile();
                  } else {
                    onOpenAuth();
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-xs shrink-0 transition-colors"
              >
                {user ? 'Manage' : 'Sign In'}
              </button>
            </div>

            {/* Owner / Admin Management Section */}
            {isAdmin && (
              <div className="space-y-2">
                <h3 className="font-semibold uppercase tracking-wider text-[11px] text-amber-400 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" />
                  Owner Administration
                </h3>
                <div className="p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl flex items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold text-amber-200 block text-xs">User Pro Management</span>
                    <span className="text-[11px] text-amber-300/80">View all users & assign Pro privileges</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAdminUsers?.();
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shrink-0 shadow-sm"
                  >
                    Manage Users
                  </button>
                </div>
              </div>
            )}

            {/* Appearance Section */}
            <div className="space-y-2">
              <h3 className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">
                Appearance & Theme
              </h3>
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl border border-slate-700/40">
                <div className="flex items-center gap-2 text-slate-200 font-medium">
                  {theme === 'dark' ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
                  <span>{theme === 'dark' ? 'Dark Theme (Night mode)' : 'Light Theme (Day mode)'}</span>
                </div>
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors"
                >
                  Switch
                </button>
              </div>
            </div>

            {/* Storage & Local Cache */}
            <div className="space-y-2">
              <h3 className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">
                Storage & Cache
              </h3>
              <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/40 space-y-2">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-slate-400" />
                    Saved Documents & History:
                  </span>
                  <span className="font-semibold text-slate-100">{historyCount} items</span>
                </div>
                <div className="pt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Temporary images & offline cache</span>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    className="text-red-400 hover:text-red-300 font-medium text-xs flex items-center gap-1"
                  >
                    <Trash className="w-3 h-3" />
                    Clear Cache
                  </button>
                </div>
                {clearedNotice && (
                  <p className="text-emerald-400 text-[11px] flex items-center gap-1 pt-1">
                    <CheckCircle className="w-3 h-3" /> Offline cache cleared successfully.
                  </p>
                )}
              </div>
            </div>

            {/* PWA Install Button if supported */}
            {installPrompt && (
              <div className="p-3 bg-indigo-950/40 border border-indigo-800/50 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-indigo-200">
                  <Download className="w-4 h-4 text-indigo-400 shrink-0" />
                  <div>
                    <p className="font-semibold">Install App on Device</p>
                    <p className="text-[11px] text-slate-400">Add to home screen for instant offline launch</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onInstallPwa}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shrink-0"
                >
                  Install
                </button>
              </div>
            )}

            {/* Guides & Support Links */}
            <div className="space-y-1.5 pt-1">
              <h3 className="font-semibold uppercase tracking-wider text-[11px] text-slate-400 mb-1">
                Help & Information
              </h3>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenOnboarding();
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/70 text-slate-300 text-left transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  Welcome Tour & Feature Guide
                </span>
                <span className="text-[11px] text-slate-400">View</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenHelp();
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/70 text-slate-300 text-left transition-colors"
              >
                <span className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-400" />
                  Help & Contact Support
                </span>
                <span className="text-[11px] text-slate-400">support@aidocscanner.in</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenPrivacy();
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/70 text-slate-300 text-left transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Privacy Policy & Data Security
                </span>
                <span className="text-[11px] text-slate-400">Read</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTerms();
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/70 text-slate-300 text-left transition-colors"
              >
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-400" />
                  Terms of Service & Fair Use
                </span>
                <span className="text-[11px] text-slate-400">Read</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAbout();
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/70 text-slate-300 text-left transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  About AI Document Helper
                </span>
                <span className="text-[11px] text-slate-400">v2.4</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
