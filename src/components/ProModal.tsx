import React, { useState } from 'react';
import {
  X,
  Crown,
  Check,
  Zap,
  Sparkles,
  ShieldCheck,
  FileCheck2,
  Share2,
  Star,
  Infinity as InfinityIcon,
  Mail,
  Copy,
  CheckCircle2,
  Users,
} from 'lucide-react';
import { PlanTier } from '../types';
import { useAuth } from '../context/AuthContext';

interface ProModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanTier;
  onUpgrade?: () => void;
  onDowngrade?: () => void;
  isLimitReached?: boolean;
  onOpenAdminUsers?: () => void;
}

export const ProModal: React.FC<ProModalProps> = ({
  isOpen,
  onClose,
  plan,
  onUpgrade,
  onDowngrade,
  isLimitReached = false,
  onOpenAdminUsers,
}) => {
  const { user } = useAuth();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [showInviteNotice, setShowInviteNotice] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  if (!isOpen) return null;

  const isPro = plan === 'pro';
  const isAdmin = Boolean(user?.isAdmin || user?.email?.toLowerCase() === 'aadeshv825@gmail.com');
  const OWNER_EMAIL = 'aadeshv825@gmail.com';

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(OWNER_EMAIL);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleUpgradeClick = () => {
    setShowInviteNotice(true);
  };

  const benefits = [
    {
      icon: InfinityIcon,
      title: 'Unlimited Daily Processing',
      description: 'Never worry about daily limits. Scan, extract, and translate as many documents as you need.',
    },
    {
      icon: Zap,
      title: 'Priority Gemini AI Engine',
      description: 'Faster response times with priority routing and automatic multi-model failover.',
    },
    {
      icon: FileCheck2,
      title: 'High-Accuracy Document OCR',
      description: 'Extract multi-page agreements, messy bills, and Devanagari Hindi script with pinpoint precision.',
    },
    {
      icon: Share2,
      title: 'One-Tap Mobile Sharing',
      description: 'Export structured briefs directly to WhatsApp, Gmail, Slack, or Google Drive via native share.',
    },
    {
      icon: Star,
      title: 'Unlimited Starred Vault',
      description: 'Save contracts, leases, and receipts to your Favorites with offline search.',
    },
    {
      icon: ShieldCheck,
      title: 'Private & Secure Processing',
      description: 'Client-side image compression and zero persistent storage of sensitive credentials.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="relative p-5 bg-gradient-to-r from-amber-500/15 via-blue-500/15 to-indigo-500/15 border-b border-slate-800 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 shadow-md">
              <Crown className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  Document Helper Pro
                </h2>
                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                  isPro
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}>
                  {isPro ? 'Pro Active' : 'Free Tier'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Full-powered AI document suite without limits
              </p>
            </div>
          </div>

          <button
            id="btn-close-pro-modal"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Limit Reached Banner */}
        {isLimitReached && (
          <div className="p-3 bg-amber-950/70 border-b border-amber-500/50 flex items-center gap-2.5 text-amber-200 text-xs">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <span className="font-bold block text-amber-300">Daily Free Quota Reached (5/5)</span>
              <span className="text-[11px] text-amber-200/90">Request your Pro upgrade below for instant, unlimited operations.</span>
            </div>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Plan Comparison Pills */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className={`p-3 rounded-xl border ${
              !isPro
                ? 'bg-slate-800/80 border-slate-600'
                : 'bg-slate-800/30 border-slate-800 opacity-70'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-300">Free Tier</span>
                {!isPro && <span className="text-[10px] text-blue-400 font-medium">Current</span>}
              </div>
              <p className="text-[11px] text-slate-400">
                5 operations / day, standard speed, local session history.
              </p>
            </div>

            <div className={`p-3 rounded-xl border ${
              isPro
                ? 'bg-amber-950/30 border-amber-500/50'
                : 'bg-slate-800/80 border-amber-500/30'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                  <Crown className="w-3 h-3 fill-current" /> Pro Tier
                </span>
                {isPro && <span className="text-[10px] text-amber-400 font-medium">Active</span>}
              </div>
              <p className="text-[11px] text-slate-300">
                Unlimited scans, priority AI, full export & starred vault.
              </p>
            </div>
          </div>

          {/* Pricing Toggle */}
          <div className="bg-slate-800/60 p-1 rounded-xl flex items-center border border-slate-700/60">
            <button
              onClick={() => setBillingCycle('annual')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                billingCycle === 'annual'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Annual <span className="text-[10px] font-bold text-amber-300 ml-1">Save 41%</span>
            </button>
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Pricing Display */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5 flex items-baseline justify-between">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl sm:text-2xl font-bold text-slate-100">
                  {billingCycle === 'annual' ? '₹699' : '₹99'}
                </span>
                <span className="text-xs text-slate-400">
                  {billingCycle === 'annual' ? '/ year (₹58/mo)' : '/ month'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {billingCycle === 'annual'
                  ? 'Manual Pro membership. Managed by administrator.'
                  : 'Billed monthly. Managed by administrator.'}
              </p>
            </div>

            <span className="text-[11px] px-2 py-1 rounded-md bg-emerald-950/60 border border-emerald-800/50 text-emerald-300 font-semibold">
              Owner Verified
            </span>
          </div>

          {/* Requirement 8: Friendly Invitation Notice when Upgrade to Pro clicked */}
          {showInviteNotice && !isPro && (
            <div className="p-4 bg-gradient-to-br from-amber-950/50 via-slate-800 to-indigo-950/40 border border-amber-500/50 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-amber-300">
                    Pro Upgrades by Invitation
                  </h4>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Pro upgrades are currently available by invitation. Please contact the owner ({OWNER_EMAIL}) to activate unlimited Pro access for your account.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href={`mailto:${OWNER_EMAIL}?subject=Pro%20Access%20Request%20-%20AI%20Document%20Helper&body=Hello%2C%0A%0AI%20would%20like%20to%20request%20Pro%20access%20for%20my%20account%3A%0AEmail%3A%20${encodeURIComponent(user?.email || '')}%0AName%3A%20${encodeURIComponent(user?.name || '')}%0A%0AThank%20you!`}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Email Owner
                </a>

                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl flex items-center gap-1.5 border border-slate-700 transition-colors"
                >
                  {copiedEmail ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy Email Address</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Owner Quick Shortcut if logged-in user is Owner / Admin */}
          {isAdmin && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <Users className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-bold text-amber-200 block">Owner / Admin Shortcut</span>
                  <span className="text-[11px] text-amber-300/80">Manage all users & toggle Pro access instantly</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAdminUsers?.();
                }}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors shrink-0 shadow-sm"
              >
                Manage Users
              </button>
            </div>
          )}

          {/* Pro Benefits Checklist */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-0.5">
              Everything Included in Pro:
            </h3>
            <div className="grid grid-cols-1 gap-2.5">
              {benefits.map((b, idx) => {
                const Icon = b.icon;
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-2.5 bg-slate-800/50 border border-slate-700/40 rounded-xl"
                  >
                    <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 shrink-0 mt-0.5">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-slate-200">
                        {b.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                        {b.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer / Action Button */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-2">
          {!isPro ? (
            <button
              id="btn-upgrade-pro-invitation"
              onClick={handleUpgradeClick}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.99]"
            >
              <Crown className="w-4 h-4 fill-current" />
              Upgrade to Pro
            </button>
          ) : (
            <div className="w-full py-2.5 px-4 bg-amber-950/40 border border-amber-500/40 text-amber-300 font-bold text-xs rounded-xl flex items-center justify-center gap-2">
              <Crown className="w-4 h-4 fill-current" />
              Pro Tier Active on this Account (Unlimited Access)
            </div>
          )}

          <p className="text-[10px] text-center text-slate-500">
            Pro access is assigned directly by the application administrator.
          </p>
        </div>
      </div>
    </div>
  );
};

