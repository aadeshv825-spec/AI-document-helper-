import React, { useState, useEffect } from 'react';
import {
  Languages,
  ArrowRightLeft,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Sparkles,
  RefreshCw,
  BookOpen,
  AlertCircle,
  FileText,
  Share2,
  Star,
  Download,
} from 'lucide-react';
import { TranslationResponse, ActiveTab } from '../types';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';
import { speakText, stopSpeaking } from '../utils/speech';
import { shareDocumentContent } from '../utils/share';
import { downloadTextFile } from '../utils/download';
import { apiFetch } from '../utils/apiClient';
import { QuickActionsBar } from './QuickActionsBar';

interface HindiTranslationProps {
  initialText?: string;
  onTransferText?: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

export const HindiTranslationTool: React.FC<HindiTranslationProps> = ({
  initialText = '',
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [inputText, setInputText] = useState<string>(
    initialText && !initialText.startsWith('data:image/') ? initialText : ''
  );
  const [sourceLang, setSourceLang] = useState<'English' | 'Hindi' | 'Auto'>('Auto');
  const [targetLang, setTargetLang] = useState<'Hindi' | 'English'>('Hindi');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<TranslationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [shared, setShared] = useState<boolean>(false);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  useEffect(() => {
    if (initialText && !initialText.startsWith('data:image/')) {
      setInputText(initialText);
    }
  }, [initialText]);

  const handleSwapLanguages = () => {
    const nextTarget = targetLang === 'Hindi' ? 'English' : 'Hindi';
    const nextSource = targetLang;
    setTargetLang(nextTarget);
    setSourceLang(nextSource);
    if (result?.translatedText) {
      setInputText(result.translatedText);
      setResult(null);
    }
  };

  const handleTranslate = async () => {
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    if (!inputText.trim()) {
      setError('Please enter or paste text to translate');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/hindi-translation', {
        method: 'POST',
        body: JSON.stringify({
          text: inputText,
          sourceLang,
          targetLang,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned ${res.status}`);
      }

      const data: TranslationResponse = await res.json();
      setResult(data);

      onSaveHistory(
        `${targetLang} Translation: ${inputText.slice(0, 30)}`,
        'hindi-translation',
        `Original (${data.sourceLang}):\n${inputText}\n\nTranslation (${data.targetLang}):\n${data.translatedText}`
      );
    } catch (err: any) {
      setError(err.message || 'Translation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result?.translatedText) return;
    navigator.clipboard.writeText(result.translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!result?.translatedText) return;
    const shareText = `Original (${result.sourceLang}):\n${inputText}\n\nTranslation (${result.targetLang}):\n${result.translatedText}`;
    const outcome = await shareDocumentContent({
      title: `${result.targetLang} Translation`,
      text: shareText,
    });
    if (outcome !== 'dismissed') {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!result?.translatedText) return;
    const content = `Original (${result.sourceLang}):\n${inputText}\n\n${result.targetLang} Translation:\n${result.translatedText}${
      result.romanizedPronunciation ? `\n\nPronunciation:\n${result.romanizedPronunciation}` : ''
    }`;
    downloadTextFile(
      content,
      `Translation_${result.targetLang}_${Date.now()}.txt`,
      'text/plain;charset=utf-8'
    );
  };

  const handleToggleSpeak = async () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    } else if (result?.translatedText) {
      setIsSpeaking(true);
      const voiceLang = targetLang === 'Hindi' ? 'hi-IN' : 'en-US';
      await speakText(result.translatedText, voiceLang);
      setIsSpeaking(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Daily Free Limit Alert Banner */}
      {isLimitReached && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200 shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Daily free limit reached (5/5). Start 30-day Pro trial for unlimited translations.</span>
          </div>
          <button
            onClick={onOpenPro}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs shrink-0 transition-colors shadow-sm"
          >
            Start Trial
          </button>
        </div>
      )}

      {/* Language Switch Bar */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center justify-between gap-2 shadow-sm">
        <div className="flex-1 text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">From</span>
          <span className="text-xs font-semibold text-slate-200">
            {sourceLang === 'Auto' ? 'Detect (Auto)' : sourceLang}
          </span>
        </div>

        <button
          id="btn-swap-languages"
          onClick={handleSwapLanguages}
          className="p-2 rounded-lg bg-slate-700/70 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300 transition-colors active:scale-95"
          title="Swap Languages"
          aria-label="Swap Languages"
        >
          <ArrowRightLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">To</span>
          <span className="text-xs font-semibold text-indigo-300">
            {targetLang === 'Hindi' ? 'हिन्दी (Hindi)' : 'English'}
          </span>
        </div>
      </div>

      {/* Input Box */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <label className="text-slate-300 font-medium flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5 text-indigo-400" />
            Document Text
          </label>
          {inputText && (
            <button
              onClick={() => {
                setInputText('');
                setResult(null);
              }}
              className="text-slate-400 hover:text-rose-400 text-[11px]"
            >
              Clear
            </button>
          )}
        </div>

        {/* Quick Sample Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] text-slate-400">Sample:</span>
          <button
            onClick={() => {
              setInputText(
                'This agreement shall remain valid for eleven months. Both parties agree that the security deposit of Rs. 50,000 shall be refunded upon vacant possession without interest.'
              );
              setTargetLang('Hindi');
              setSourceLang('English');
              setResult(null);
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
          >
            Lease Clause (Eng)
          </button>
          <button
            onClick={() => {
              setInputText(
                'अधोहस्ताक्षरी को यह सूचित करने का निर्देश हुआ है कि सभी प्रशासनिक विभागों में अवकाश नियमों में संशोधन तत्काल प्रभाव से लागू किए जाते हैं।'
              );
              setTargetLang('English');
              setSourceLang('Hindi');
              setResult(null);
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
          >
            कार्यालय आदेश (Hindi)
          </button>
        </div>

        <textarea
          id="translate-input-textarea"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            targetLang === 'Hindi'
              ? 'Enter English official letter, clause, or notice to translate into formal Hindi...'
              : 'अनुवाद के लिए यहाँ हिन्दी दस्तावेज़ या वाक्य लिखें...'
          }
          rows={4}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
        />

        <button
          id="btn-run-translation"
          onClick={handleTranslate}
          disabled={isLoading || !inputText.trim()}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/60 text-white font-medium text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
        >
          {isLoading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Translating with AI...
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              Translate Now
            </>
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/60 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Translation Output Card */}
      {result && (
        <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
            <div>
              <span className="text-xs font-semibold text-indigo-300">
                {result.targetLang === 'Hindi' ? 'हिन्दी अनुवाद (Hindi Translation)' : 'English Translation'}
              </span>
              <span className="text-[10px] text-slate-400 block">
                Source: {result.sourceLang}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                id="btn-listen-translation"
                onClick={handleToggleSpeak}
                className="p-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Speak translation"
              >
                {isSpeaking ? (
                  <VolumeX className="w-4 h-4 text-amber-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <button
                id="btn-copy-translation"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Copy translation"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>

              <button
                id="btn-share-translation"
                onClick={handleShare}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Share translation via Web Share"
              >
                {shared ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Shared</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </>
                )}
              </button>

              <button
                id="btn-download-translation"
                onClick={handleDownload}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Download translation text file"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>

              <button
                id="btn-favorite-translation"
                onClick={() => {
                  const nextFav = !isFavorited;
                  setIsFavorited(nextFav);
                  if (result) {
                    onSaveHistory(
                      `${targetLang} Translation: ${inputText.slice(0, 30)}`,
                      'hindi-translation',
                      `Original (${result.sourceLang}):\n${inputText}\n\nTranslation (${result.targetLang}):\n${result.translatedText}`,
                      nextFav
                    );
                  }
                }}
                className={`p-1.5 rounded-lg hover:bg-slate-700 transition-colors ${
                  isFavorited
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'bg-slate-700/60 text-slate-300'
                }`}
                title={isFavorited ? 'Saved to Favorites' : 'Save to Favorites'}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
              </button>
            </div>
          </div>

          {/* Main Translated Text */}
          <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-sm text-slate-100 font-sans leading-relaxed whitespace-pre-wrap">
            {result.translatedText}
          </div>

          {/* Romanized Pronunciation Card */}
          {result.romanizedPronunciation && (
            <div className="p-2.5 bg-indigo-950/30 border border-indigo-900/40 rounded-lg space-y-1">
              <span className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wider block">
                Phonetic Reading Guide (Hinglish)
              </span>
              <p className="text-xs text-indigo-200/90 italic font-mono leading-relaxed">
                "{result.romanizedPronunciation}"
              </p>
            </div>
          )}

          {/* Key Official Terms Glossary */}
          {result.glossary && result.glossary.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                Official Document Vocabulary
              </span>
              <div className="grid grid-cols-1 gap-1.5">
                {result.glossary.map((g, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-slate-900/50 border border-slate-800 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                  >
                    <span className="font-semibold text-indigo-300">{g.term}</span>
                    <span className="text-slate-400 text-[11px]">{g.explanation}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions (Summarize, Translate, Ask Questions, Extract Key Points, Make Notes, Find Dates/Names/Amounts) */}
          <div className="pt-2 border-t border-slate-700/60">
            <QuickActionsBar
              documentText={result.translatedText}
              documentTitle={`${result.targetLang} Translation`}
              onTransferText={onTransferText || (() => {})}
              onSaveHistory={onSaveHistory}
            />
          </div>
        </div>
      )}
    </div>
  );
};
