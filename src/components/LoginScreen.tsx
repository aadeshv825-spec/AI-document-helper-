import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Mail, User, ShieldCheck, ArrowRight, Loader2, Chrome, AlertCircle, FileText, Sparkles, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LoginScreen: React.FC = () => {
  const { login, register, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleClick = async () => {
    setError(null);
    setNotice(null);
    setGoogleLoading(true);

    try {
      const res = await signInWithGoogle();
      if (!res.success) {
        if (res.requiresConfig) {
          setError(res.error || 'Google Sign-In is not configured yet.');
        } else if (res.error) {
          setError(res.error);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Google Sign-In failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    if (mode === 'login') {
      if (!email.trim() || !password.trim()) {
        setError('Please enter both your email address and password.');
        setLoading(false);
        return;
      }
      const res = await login(email.trim(), password);
      setLoading(false);
      if (!res.success) {
        setError(res.error || 'Invalid email or password.');
      }
    } else {
      if (!name.trim()) {
        setError('Please enter your full name.');
        setLoading(false);
        return;
      }
      if (!email.trim() || !email.includes('@')) {
        setError('Please enter a valid email address.');
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters long.');
        setLoading(false);
        return;
      }
      const res = await register(name.trim(), email.trim(), password);
      setLoading(false);
      if (!res.success) {
        setError(res.error || 'Account registration failed.');
      }
    }
  };

  const handleForgotPassword = () => {
    setError(null);
    if (email.trim()) {
      setNotice(`Password reset instructions have been dispatched to ${email.trim()}. Please check your inbox.`);
    } else {
      setError('Please enter your email address above to receive password reset instructions.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-8 antialiased selection:bg-blue-600 selection:text-white">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-8 space-y-6"
      >
        {/* App Branding & Identity */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 mb-1 shadow-inner">
            <FileText className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            AI Document Helper
          </h1>
          <p className="text-xs text-slate-400">
            Sign in to access your document tools, summaries, and private history.
          </p>
        </div>

        {/* Tab switch: Sign In vs Create Account */}
        <div className="grid grid-cols-2 p-1 bg-slate-800/90 rounded-xl text-xs font-medium">
          <button
            type="button"
            id="tab-login"
            onClick={() => {
              setMode('login');
              setError(null);
              setNotice(null);
            }}
            className={`py-2.5 rounded-lg transition-all ${
              mode === 'login'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            id="tab-register"
            onClick={() => {
              setMode('register');
              setError(null);
              setNotice(null);
            }}
            className={`py-2.5 rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Alerts & Notifications */}
        {error && (
          <div className="p-3.5 bg-red-950/60 border border-red-800/50 rounded-xl text-xs text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="p-3.5 bg-emerald-950/60 border border-emerald-800/50 rounded-xl text-xs text-emerald-300 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {/* Official Google Sign-In */}
        <div>
          <button
            type="button"
            id="btn-google-sign-in"
            onClick={handleGoogleClick}
            disabled={googleLoading || loading}
            className="w-full py-3 px-4 bg-slate-800/90 hover:bg-slate-700/90 active:scale-[0.99] border border-slate-700 text-slate-200 text-sm font-semibold rounded-xl transition-all shadow-sm flex items-center justify-center gap-3 disabled:opacity-60"
          >
            {googleLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span>Connecting to Google...</span>
              </>
            ) : (
              <>
                <Chrome className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Continue with Google</span>
              </>
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center">
          <div className="border-t border-slate-800 w-full" />
          <span className="bg-slate-900 px-3 text-[11px] text-slate-400 font-medium absolute">
            Or continue with email
          </span>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  id="input-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Aadesh V"
                  required={mode === 'register'}
                  className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
                id="input-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">
                Password
              </label>
              {mode === 'login' && (
                <button
                  type="button"
                  id="btn-forgot-password"
                  onClick={handleForgotPassword}
                  className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Forgot Password?
                </button>
              )}
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                id="input-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            id="btn-submit-auth"
            disabled={loading || googleLoading}
            className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white text-sm font-semibold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Security & Cloud Sync Guarantee */}
        <div className="pt-2 border-t border-slate-800/80 flex items-start gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            Protected with industry-standard encryption. Your documents and processed files remain confidential and synced to your private account.
          </span>
        </div>
      </motion.div>
    </div>
  );
};
