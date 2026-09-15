import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Mail, User, ShieldCheck, ArrowRight, Loader2, Sparkles, CheckCircle2, Chrome, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  defaultMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultMode = 'login',
}) => {
  const { login, register, demoLogin, signInWithGoogle, demoGoogleLogin, getGoogleOAuthStatus } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(defaultMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [googleNotice, setGoogleNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isGoogleConfigured, setIsGoogleConfigured] = useState<boolean | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      getGoogleOAuthStatus().then((status) => {
        setIsGoogleConfigured(status.configured);
      }).catch(() => {
        setIsGoogleConfigured(false);
      });
    }
  }, [isOpen, getGoogleOAuthStatus]);

  if (!isOpen) return null;

  const handleGoogleClick = async () => {
    setError(null);
    setGoogleNotice(null);
    setGoogleLoading(true);

    try {
      const res = await signInWithGoogle();
      if (res.success) {
        onSuccess?.();
        onClose();
      } else if (res.requiresConfig) {
        setGoogleNotice('Not configured yet: Google Client ID & Secret have not been set in server environment settings. You can use Email/Password or 1-Tap Demo below.');
      } else {
        setError(res.error || 'Google Sign-In could not be completed.');
      }
    } catch (err: any) {
      setError(err?.message || 'Google Sign-In failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDemoGoogleClick = async () => {
    setError(null);
    setGoogleNotice(null);
    setGoogleLoading(true);
    const res = await demoGoogleLogin();
    setGoogleLoading(false);
    if (res.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(res.error || 'Google demo sign-in failed.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let res;
    if (mode === 'login') {
      res = await login(email, password);
    } else {
      if (!name.trim()) {
        setError('Please provide your name.');
        setLoading(false);
        return;
      }
      res = await register(name, email, password);
    }

    setLoading(false);
    if (res.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(res.error || 'Authentication failed.');
    }
  };

  const handleDemoClick = async () => {
    setError(null);
    setLoading(true);
    const res = await demoLogin();
    setLoading(false);
    if (res.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(res.error || 'Demo login failed.');
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">
                {mode === 'login' ? 'Sign In to Your Account' : 'Create an Account'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Mode Switch Tabs */}
            <div className="grid grid-cols-2 p-1 bg-slate-800/80 rounded-xl text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2 rounded-lg transition-all ${
                  mode === 'login'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`py-2 rounded-lg transition-all ${
                  mode === 'register'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="p-3 bg-red-950/60 border border-red-800/50 rounded-xl text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Google Sign-In Option */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleGoogleClick}
                disabled={googleLoading || loading}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700/80 active:scale-[0.99] border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all shadow-sm flex items-center justify-between gap-2 disabled:opacity-60"
              >
                <div className="flex items-center gap-2.5">
                  <Chrome className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>Continue with Google</span>
                </div>
                {isGoogleConfigured === false ? (
                  <span className="text-[10px] bg-slate-700/80 text-amber-300 px-2 py-0.5 rounded-md font-medium border border-amber-500/20">
                    Not configured yet
                  </span>
                ) : isGoogleConfigured === true ? (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-md font-medium border border-emerald-500/20">
                    Ready
                  </span>
                ) : null}
              </button>

              {/* Informative notice if clicked when not configured */}
              {googleNotice && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-200/90 flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{googleNotice}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleDemoGoogleClick}
                      className="px-2.5 py-1 bg-amber-600/80 hover:bg-amber-600 text-slate-950 font-semibold text-[10px] rounded-lg transition-colors"
                    >
                      Test with Demo Google Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => setGoogleNotice(null)}
                      className="text-[10px] text-slate-400 hover:text-slate-200 px-1"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Demo Login Option */}
            <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-blue-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  Quick Test Account
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Try full features instantly as Aadesh V
                </p>
              </div>
              <button
                type="button"
                onClick={handleDemoClick}
                disabled={loading || googleLoading}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold rounded-lg shrink-0 transition-all shadow-sm"
              >
                1-Tap Demo
              </button>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="border-t border-slate-800 w-full" />
              <span className="bg-slate-900 px-3 text-[11px] text-slate-400 font-medium absolute">
                Or use email
              </span>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Your Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white text-sm font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Please wait...</span>
                  </>
                ) : (
                  <>
                    <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Privacy & Sync Guarantee */}
            <div className="pt-2 border-t border-slate-800/80 flex items-start gap-2 text-[11px] text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Your documents, summaries, and favorites are synced securely to your private account across all devices.
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
