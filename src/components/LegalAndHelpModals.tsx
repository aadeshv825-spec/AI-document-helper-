import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Shield,
  FileText,
  HelpCircle,
  Info,
  Mail,
  CheckCircle2,
  Lock,
  Cpu,
  Smartphone,
  ExternalLink,
} from 'lucide-react';

interface ModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<ModalBaseProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Info className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">About AI Document Helper</h2>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300 leading-relaxed">
            <p className="text-sm font-medium text-slate-200">
              AI Document Helper is a mobile-first intelligent document workstation designed for students, professionals, and small businesses in India and worldwide.
            </p>

            <div className="space-y-3 pt-2">
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 flex items-start gap-2.5">
                <Cpu className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-100 mb-0.5">Gemini 3 Multimodal Intelligence</h4>
                  <p className="text-slate-400">
                    High-accuracy optical character recognition (OCR), executive summaries, Q&A citations, and verified Hindi-English translation powered by server-side Gemini models.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 flex items-start gap-2.5">
                <Smartphone className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-100 mb-0.5">Offline-Capable PDF Toolkit</h4>
                  <p className="text-slate-400">
                    Client-side PDF merging, splitting, compression, and image conversion using `pdf-lib` and HTML5 Canvas. Your documents never leave your browser for basic PDF utilities.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-100 mb-0.5">Privacy-First Architecture</h4>
                  <p className="text-slate-400">
                    Zero persistent training on customer documents. All API keys remain isolated strictly on the server backend with encrypted storage.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>Version 2.4.0 (Production Build)</span>
              <span>AI Document Helper</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export const HelpModal: React.FC<ModalBaseProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <HelpCircle className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">Help & Support</h2>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300">
            {/* Direct Contact Support Card */}
            <div className="p-4 bg-blue-950/40 border border-blue-800/50 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-blue-300 font-semibold text-sm">
                <Mail className="w-4 h-4 text-blue-400" />
                Contact Developer & Support
              </div>
              <p className="text-slate-300">
                Have questions, bug reports, or feature requests? Reach out directly:
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-blue-200 font-medium">aadeshv825@gmail.com</span>
                <a
                  href="mailto:aadeshv825@gmail.com"
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-semibold"
                >
                  Send Email
                </a>
              </div>
            </div>

            <h3 className="font-semibold text-slate-200 pt-1">Frequently Asked Questions</h3>

            <div className="space-y-2.5">
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <h4 className="font-medium text-slate-200 mb-1">How many actions do Free users get?</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Free accounts receive 5 AI actions every day (OCR, summary, Q&A, translation, and letter drafting). Unlimited actions are unlocked with Pro (₹99/month or ₹699/year) or via our 30-day trial.
                </p>
              </div>

              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <h4 className="font-medium text-slate-200 mb-1">Are my uploaded documents private?</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Yes. Images and document texts sent for AI inference are processed transiently in server memory and not stored for model training. Offline PDF tools process files completely on your device.
                </p>
              </div>

              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <h4 className="font-medium text-slate-200 mb-1">How do I access my saved documents on another phone or computer?</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Simply Sign In to your account. Your history, favorites, summaries, and categorized folders sync automatically across all devices.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export const PrivacyModal: React.FC<ModalBaseProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Shield className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">Privacy Policy</h2>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300 leading-relaxed">
            <p className="text-slate-400 text-[11px]">
              Last updated: September 2026. Compliant with international data privacy standards and the Digital Personal Data Protection (DPDP) Act.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-slate-100 mb-1">1. Information We Collect</h4>
                <p className="text-slate-400">
                  We collect account identifiers (email address, display name) and encrypted session credentials strictly to maintain your account and sync your saved documents across your authorized devices.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">2. Document Processing & AI Protection</h4>
                <p className="text-slate-400">
                  Documents submitted for AI text extraction, summarization, Q&A, and translation are sent via TLS 1.3 encrypted connections to our secure backend proxy. Neither AI Document Helper nor our AI model providers store or train on your personal document contents.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">3. Client-Side Document Tools</h4>
                <p className="text-slate-400">
                  Our PDF utilities (Merge, Split, Compress, Convert) and the Scan & Clean tool operate locally in your browser memory using WebAssembly and Canvas APIs. The original files never touch our servers.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">4. Right to Deletion (Right to be Forgotten)</h4>
                <p className="text-slate-400">
                  You have absolute control over your data. You can delete individual documents anytime, or permanently delete your entire account and all cloud records with one tap from the Profile settings.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export const TermsModal: React.FC<ModalBaseProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <FileText className="w-4 h-4" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">Terms of Service</h2>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto text-xs text-slate-300 leading-relaxed">
            <p className="text-slate-400 text-[11px]">
              Effective Date: September 2026. By using AI Document Helper, you agree to these Terms.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-slate-100 mb-1">1. Acceptable Use</h4>
                <p className="text-slate-400">
                  You agree to use AI Document Helper only for legitimate document review, translation, summarization, and conversion purposes. You must not upload unlawful or malicious files.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">2. Service Plans & Fair Use</h4>
                <p className="text-slate-400">
                  Free accounts receive 5 daily AI actions. Pro tier (₹99/month or ₹699/year) provides unlimited AI document actions, subject to reasonable automated abuse mitigation to ensure server stability for all users.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">3. Accuracy Disclaimer</h4>
                <p className="text-slate-400">
                  While our OCR and translation models achieve high fidelity, AI outputs should be reviewed before making binding legal, official, or medical commitments. AI Document Helper does not provide formal legal or financial counsel.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
