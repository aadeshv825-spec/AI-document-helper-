import React from 'react';
import { FileText, Clock, Sparkles, ChevronLeft, Sun, Moon, Crown, Settings, User, ShieldCheck } from 'lucide-react';
import { ActiveTab, PlanTier, UserProfile } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  hasGeminiKey: boolean;
  historyCount: number;
  onOpenHistory: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  plan?: PlanTier;
  onOpenPro?: () => void;
  user?: UserProfile | null;
  onOpenProfile?: () => void;
  onOpenAuth?: () => void;
  onOpenSettings?: () => void;
  onOpenAdminUsers?: () => void;
}


const TAB_TITLES: Record<ActiveTab, { title: string; subtitle: string }> = {
  'home': { title: 'AI Document Helper', subtitle: 'Mobile Document Assistant' },
  'scan-clean': { title: 'Scan & Clean Doc', subtitle: 'Straighten, Crop & Enhance Readability' },
  'pdf-tools': { title: 'PDF Tools', subtitle: 'Merge, Split, Compress & Convert' },
  'photo-to-text': { title: 'Photo to Text', subtitle: 'Camera OCR & Data Extraction' },
  'pdf-summary': { title: 'PDF & Doc Summary', subtitle: 'Key Points & Action Items' },
  'ask-document': { title: 'Ask Document', subtitle: 'Interactive Q&A on Documents' },
  'hindi-translation': { title: 'Hindi ⇄ English', subtitle: 'Translation & Vocabulary' },
  'ai-writer': { title: 'AI Writer', subtitle: 'Draft Letters, Notices & Emails' },
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  hasGeminiKey,
  historyCount,
  onOpenHistory,
  theme = 'dark',
  onToggleTheme,
  plan = 'free',
  onOpenPro,
  user,
  onOpenProfile,
  onOpenAuth,
  onOpenSettings,
  onOpenAdminUsers,
}) => {
  const current = TAB_TITLES[activeTab] || TAB_TITLES.home;
  const isPro = plan === 'pro';
  const isAdmin = Boolean(user?.isAdmin || user?.email?.toLowerCase() === 'aadeshv825@gmail.com');

  return (
    <header className="sticky top-0 z-30 w-full bg-slate-900/95 backdrop-blur border-b border-slate-800 px-3 sm:px-4 py-2.5 pt-safe">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {activeTab !== 'home' ? (
            <button
              id="header-back-btn"
              onClick={() => setActiveTab('home')}
              className="p-1.5 -ml-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors active:scale-95 shrink-0"
              aria-label="Back to home"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold text-slate-100 truncate tracking-tight">
                {current.title}
              </h1>
              {hasGeminiKey ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 shrink-0">
                  <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                  Gemini
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-950/70 text-amber-300 border border-amber-800/40 shrink-0">
                  Ready
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              {current.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Admin / Owner Button */}
          {isAdmin && onOpenAdminUsers && (
            <button
              id="header-admin-btn"
              onClick={onOpenAdminUsers}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors active:scale-95 shadow-xs"
              title="Manage Users & Pro Access (Owner Area)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Users</span>
            </button>
          )}

          {/* Pro / Upgrade Badge */}
          {onOpenPro && (
            <button
              id="header-pro-badge-btn"
              onClick={onOpenPro}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold transition-all active:scale-95 shadow-xs ${
                isPro
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30'
                  : 'bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/30'
              }`}
              title={isPro ? 'Pro Active - View Plan Details' : 'Upgrade to Pro'}
            >
              <Crown className={`w-3 h-3 ${isPro ? 'fill-amber-400 text-amber-400' : 'text-blue-400'}`} />
              <span className="hidden xs:inline">{isPro ? 'PRO' : 'Upgrade'}</span>
            </button>
          )}

          {/* User Account / Profile Button */}
          {user ? (
            <button
              id="header-user-btn"
              onClick={onOpenProfile}
              className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-400/40 text-blue-300 font-bold text-xs flex items-center justify-center hover:bg-blue-600/50 transition-colors"
              title={`Signed in as ${user.name} (${user.email})`}
            >
              {user.name.charAt(0).toUpperCase()}
            </button>
          ) : (
            <button
              id="header-signin-btn"
              onClick={onOpenAuth}
              className="px-2 py-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
              title="Sign In or Register"
            >
              <User className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}

          {/* Settings Trigger */}
          {onOpenSettings && (
            <button
              id="header-settings-btn"
              onClick={onOpenSettings}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              title="Settings & Help"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          {/* History Drawer Trigger */}
          <button
            id="header-history-btn"
            onClick={onOpenHistory}
            className="relative p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            title="Saved Documents & History"
            aria-label="Recent Documents"
          >
            <Clock className="w-4 h-4" />
            {historyCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
