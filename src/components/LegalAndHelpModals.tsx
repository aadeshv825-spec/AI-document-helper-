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
                    High-accuracy optical character recognition (OCR), executive summaries, Q&A, and Hindi-English translation powered by server-side Gemini models.
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
                  Free accounts receive 5 AI actions every day (OCR, summary, Q&A, translation, and letter drafting). Unlimited actions are unlocked with Pro (₹99/month or ₹699/year).
                </p>
              </div>

              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <h4 className="font-medium text-slate-200 mb-1">Are my uploaded documents private?</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Files you send to an AI feature are passed to our server and to Google's Gemini API only to produce your result; the uploaded file itself is not kept on our server. Results you save to History are stored in your account until you delete them. PDF tools (merge, split, compress, convert) and Scan & Clean run on your device.
                </p>
              </div>

              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <h4 className="font-medium text-slate-200 mb-1">How do I access my saved documents on another phone or computer?</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Sign in to the same account. Saved history, favorites and folders sync to your account when you are online.
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
              Last updated: October 2026.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-slate-100 mb-1">1. Information We Collect</h4>
                <p className="text-slate-400">
                  We store your email address, display name, preferred language, a securely hashed password (for email accounts) or your Google account ID (for Google Sign-In), your daily usage count, your Google Play subscription status, and the documents and results you save to History.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">2. Document Processing & AI Protection</h4>
                <p className="text-slate-400">
                  Documents submitted for text extraction, summarization, Q&A, translation and writing are sent over encrypted HTTPS connections to our server and processed by Google's Gemini API to generate the result. We do not use your documents to train AI models. Google processes this content under its own Gemini API terms. Please review AI results before relying on them.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">3. Client-Side Document Tools</h4>
                <p className="text-slate-400">
                  The PDF utilities (Merge, Split, Compress, Convert) and the Scan & Clean tool run on your device. These files are not uploaded unless you send the result to an AI feature.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-100 mb-1">4. Right to Deletion (Right to be Forgotten)</h4>
                <p className="text-slate-400">
                  You can delete individual documents at any time, or delete your account and saved documents from Profile settings. Records of Google Play purchases may be kept where required for billing, fraud prevention or legal reasons. Deleting your account does not cancel a Google Play subscription; cancel it in Google Play.
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
