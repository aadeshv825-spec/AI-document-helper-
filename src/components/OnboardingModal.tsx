import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera,
  FileText,
  Languages,
  Layers,
  ArrowRight,
  Check,
  X,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    icon: Camera,
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    title: 'Snap & Extract Text Accurately',
    description:
      'Photograph any paper bill, notice, certificate, or handwritten notes. Gemini multimodal vision transcribes every word, extracts key amounts and dates, and structures details automatically.',
  },
  {
    icon: FileText,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
    title: 'Instant PDF Summaries & Action Items',
    description:
      'Upload 100-page leases, bank statements, or official gazettes. Receive a crisp 3-sentence executive verdict, critical bullet points, deadlines, and action checklists in seconds.',
  },
  {
    icon: Languages,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    title: 'Official Hindi ⇄ English Translation',
    description:
      'Bilingual translation with legal and administrative vocabulary glossaries and pronunciation guides. Ask direct questions in Hindi or English to get cited answers from your documents.',
  },
  {
    icon: Layers,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    title: 'Privacy-First Client-Side PDF Tools',
    description:
      'Merge, split, compress, and convert images to PDF completely inside your browser. Your files never leave your phone, keeping confidential records 100% private.',
  },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onClose();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6 text-center space-y-6"
        >
          {/* Top Skip Button */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <button
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded transition-colors"
            >
              Skip
            </button>
          </div>

          {/* Slide Content */}
          <div className="space-y-4 py-2">
            <div
              className={`w-16 h-16 rounded-2xl border mx-auto flex items-center justify-center ${step.color} shadow-lg`}
            >
              <step.icon className="w-8 h-8" />
            </div>

            <h3 className="text-lg font-bold text-slate-100 tracking-tight px-4">
              {step.title}
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed px-4">
              {step.description}
            </p>
          </div>

          {/* Step Dots */}
          <div className="flex items-center justify-center gap-2 pt-2">
            {STEPS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentStep(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentStep ? 'w-6 bg-blue-500' : 'w-1.5 bg-slate-700'
                }`}
              />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="pt-2">
            <button
              onClick={handleNext}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-semibold text-sm rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
            >
              {isLast ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Get Started Now</span>
                </>
              ) : (
                <>
                  <span>Next Feature</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
