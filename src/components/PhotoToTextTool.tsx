import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Upload,
  Copy,
  Check,
  Volume2,
  VolumeX,
  FileSearch,
  Languages,
  MessageSquareQuote,
  RefreshCw,
  Sparkles,
  AlertCircle,
  FileText,
  Share2,
  Star,
  Download,
} from 'lucide-react';
import { PhotoToTextResponse, ActiveTab } from '../types';
import { SAMPLE_DOCUMENT_PHOTO_BASE64 } from '../data/sampleDocuments';
import { speakText, stopSpeaking } from '../utils/speech';
import { shareDocumentContent } from '../utils/share';
import { downloadTextFile } from '../utils/download';
import { QuickActionsBar } from './QuickActionsBar';
import { apiFetch } from '../utils/apiClient';

interface PhotoToTextProps {
  initialImage?: string;
  onTransferText: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

// Client-side image optimization & compression helper
// Resizes large phone photos (often 5MB-15MB) down to ~150-350KB with optimal resolution for OCR
async function optimizeImageForOCR(
  source: File | string,
  maxDimension = 1600,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          if (typeof source === 'string') return resolve(source);
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(source as File);
          return;
        }

        // Downscale while preserving aspect ratio
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (typeof source === 'string') return resolve(source);
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(source as File);
          return;
        }

        // Fill white background (ensures transparent PNGs/SVGs have high-contrast text)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // High quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to lightweight, high-clarity JPEG
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      } catch (err) {
        if (typeof source === 'string') {
          resolve(source);
        } else {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read image file'));
          reader.readAsDataURL(source);
        }
      }
    };

    img.onerror = () => {
      if (typeof source === 'string') {
        resolve(source);
      } else {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to load image file'));
        reader.readAsDataURL(source);
      }
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(source);
    }
  });
}

export const PhotoToTextTool: React.FC<PhotoToTextProps> = ({
  initialImage,
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [imagePreview, setImagePreview] = useState<string | null>(initialImage || null);
  const [promptHint, setPromptHint] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('Extracting text with AI...');
  const [result, setResult] = useState<PhotoToTextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [shared, setShared] = useState<boolean>(false);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  useEffect(() => {
    if (initialImage && initialImage.startsWith('data:image/')) {
      setImagePreview(initialImage);
      setError(null);
      setResult(null);
    }
  }, [initialImage]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);

    try {
      // Compress and optimize image before displaying or sending
      const optimized = await optimizeImageForOCR(file, 1600, 0.82);
      setImagePreview(optimized);
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } finally {
      e.target.value = '';
    }
  };

  const handleUseSample = async () => {
    setError(null);
    setResult(null);
    try {
      const optimized = await optimizeImageForOCR(SAMPLE_DOCUMENT_PHOTO_BASE64, 1200, 0.85);
      setImagePreview(optimized);
    } catch {
      setImagePreview(SAMPLE_DOCUMENT_PHOTO_BASE64);
    }
  };

  const handleProcessImage = async () => {
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    if (!imagePreview) {
      setError('Please select or capture a photo first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setLoadingStatus('Extracting text with AI...');

    const maxRetries = 2; // Up to 3 attempts total
    let lastErrorMessage = 'Failed to extract text from photo';

    try {
      // Ensure image is properly compressed before sending over the network
      const finalBase64 = await optimizeImageForOCR(imagePreview, 1600, 0.82);

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            setLoadingStatus(`Server busy, retrying connection... (Attempt ${attempt + 1}/${maxRetries + 1})`);
            await new Promise((r) => setTimeout(r, attempt * 1200));
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000); // 35-second client timeout

          const res = await apiFetch('/api/photo-to-text', {
            method: 'POST',
            body: JSON.stringify({
              imageBase64: finalBase64,
              promptHint: promptHint.trim(),
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            const isRetryable =
              res.status === 502 ||
              res.status === 503 ||
              res.status === 504 ||
              res.status === 429;

            if (isRetryable && attempt < maxRetries) {
              console.warn(`OCR attempt ${attempt + 1} failed with status ${res.status}. Retrying...`);
              continue;
            }
            throw new Error(errJson.error || `Server returned ${res.status}`);
          }

          const data: PhotoToTextResponse = await res.json();
          setResult(data);

          onSaveHistory(
            data.summary?.slice(0, 40) || 'Scanned Document',
            'photo-to-text',
            data.extractedText
          );
          return; // Success!
        } catch (fetchErr: any) {
          if (fetchErr.name === 'AbortError') {
            lastErrorMessage = 'Request timed out. Retrying with compressed image...';
            if (attempt < maxRetries) continue;
            lastErrorMessage = 'The OCR request timed out. Please check your network connection and try again.';
          } else {
            lastErrorMessage = fetchErr.message || 'Failed to extract text from photo';
            const isTransient =
              lastErrorMessage.includes('502') ||
              lastErrorMessage.includes('503') ||
              lastErrorMessage.includes('504') ||
              lastErrorMessage.includes('Failed to fetch') ||
              lastErrorMessage.includes('NetworkError');

            if (isTransient && attempt < maxRetries) {
              continue;
            }
          }

          if (attempt === maxRetries) {
            break;
          }
        }
      }

      setError(lastErrorMessage);
    } catch (err: any) {
      setError(err.message || 'Failed to process document photo');
    } finally {
      setIsLoading(false);
      setLoadingStatus('Extracting text with AI...');
    }
  };

  const handleCopy = () => {
    if (!result?.extractedText) return;
    navigator.clipboard.writeText(result.extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!result?.extractedText) return;
    const outcome = await shareDocumentContent({
      title: 'Extracted Document Text (OCR)',
      text: result.extractedText,
    });
    if (outcome !== 'dismissed') {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!result?.extractedText) return;
    downloadTextFile(
      result.extractedText,
      `OCR_Transcript_${Date.now()}.txt`,
      'text/plain;charset=utf-8'
    );
  };

  const handleToggleSpeak = async () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    } else if (result?.extractedText) {
      setIsSpeaking(true);
      await speakText(result.extractedText, 'en-US');
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
            <span>Daily free limit reached (5/5). Start 30-day Pro trial for unlimited scans.</span>
          </div>
          <button
            onClick={onOpenPro}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs shrink-0 transition-colors shadow-sm"
          >
            Start Trial
          </button>
        </div>
      )}

      {/* Action Header Card */}
      <div className="bg-slate-850 bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
          <Camera className="w-4 h-4 text-sky-400" />
          Capture or Upload Document
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Take a photo of any document, certificate, bill, or printed page to extract editable text.
        </p>

        {/* Hidden File Inputs */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          ref={cameraInputRef}
          onChange={handleFileChange}
          className="hidden"
          id="camera-input"
        />
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          id="upload-input"
        />

        {/* Mobile Buttons */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            id="btn-take-photo"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors active:scale-95"
          >
            <Camera className="w-4 h-4" />
            Take Photo
          </button>
          <button
            id="btn-upload-photo"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold border border-slate-600/60 transition-colors active:scale-95"
          >
            <Upload className="w-4 h-4" />
            Upload Image
          </button>
        </div>

        {/* Sample Photo Button */}
        <div className="mt-2.5 pt-2.5 border-t border-slate-700/40 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">No document nearby?</span>
          <button
            id="btn-use-sample-receipt"
            onClick={handleUseSample}
            className="text-[11px] font-medium text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            Use Sample Medical Report
          </button>
        </div>
      </div>

      {/* Image Preview & Settings */}
      {imagePreview && (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Selected Photo</span>
            <button
              onClick={() => {
                setImagePreview(null);
                setResult(null);
              }}
              className="text-slate-400 hover:text-rose-400 transition-colors text-[11px]"
            >
              Remove
            </button>
          </div>

          <div className="max-h-56 overflow-hidden rounded-lg bg-slate-950 flex items-center justify-center border border-slate-800">
            <img
              src={imagePreview}
              alt="Document preview"
              className="max-h-56 w-auto object-contain"
            />
          </div>

          {/* Optional Prompt Hint */}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Focus instruction (optional):
            </label>
            <input
              type="text"
              value={promptHint}
              onChange={(e) => setPromptHint(e.target.value)}
              placeholder="e.g. Extract table figures, or names and date only"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            id="btn-extract-text"
            onClick={handleProcessImage}
            disabled={isLoading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-medium text-xs rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {loadingStatus}
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Extract Text from Photo
              </>
            )}
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/60 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results Section */}
      {result && (
        <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                Extracted Content
              </span>
              {result.detectedLanguage && (
                <span className="text-[10px] text-slate-400">
                  Language: {result.detectedLanguage}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                id="btn-listen-text"
                onClick={handleToggleSpeak}
                className="p-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Read aloud"
              >
                {isSpeaking ? <VolumeX className="w-4 h-4 text-amber-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                id="btn-copy-extracted"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Copy extracted text"
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
                id="btn-share-extracted"
                onClick={handleShare}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Share extracted text via Web Share"
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
                id="btn-download-extracted"
                onClick={handleDownload}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Download extracted text as .txt"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>

              <button
                id="btn-favorite-extracted"
                onClick={() => {
                  const nextFav = !isFavorited;
                  setIsFavorited(nextFav);
                  if (result) {
                    onSaveHistory(
                      result.summary?.slice(0, 40) || 'Scanned Document',
                      'photo-to-text',
                      result.extractedText,
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

          {/* Quick Summary Pill if present */}
          {result.summary && (
            <div className="p-2.5 bg-blue-950/40 border border-blue-800/40 rounded-lg text-xs text-blue-200 leading-relaxed">
              <strong className="text-blue-300">Summary: </strong>
              {result.summary}
            </div>
          )}

          {/* Structured Key Values */}
          {result.structuredDetails && result.structuredDetails.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                Key Fields Identified
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {result.structuredDetails.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2 bg-slate-900/60 border border-slate-800 rounded-lg text-xs flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-400 font-medium">{item.label}:</span>
                    <span className="text-slate-200 font-semibold truncate text-right">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw Text View */}
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Full Text Transcript
            </span>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
              {result.extractedText}
            </div>
          </div>

          {/* Send to Other Tools (Smooth Inter-tool Navigation) */}
          <div className="pt-2 border-t border-slate-700/60">
            <span className="text-[11px] font-medium text-slate-400 block mb-2">
              Continue with this text:
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                id="btn-send-to-summary"
                onClick={() => onTransferText(result.extractedText, 'pdf-summary')}
                className="py-2 px-1 text-center bg-slate-700/50 hover:bg-slate-700 rounded-lg text-[11px] text-slate-200 transition-colors flex flex-col items-center gap-1"
              >
                <FileSearch className="w-3.5 h-3.5 text-emerald-400" />
                Summarize
              </button>
              <button
                id="btn-send-to-translate"
                onClick={() => onTransferText(result.extractedText, 'hindi-translation')}
                className="py-2 px-1 text-center bg-slate-700/50 hover:bg-slate-700 rounded-lg text-[11px] text-slate-200 transition-colors flex flex-col items-center gap-1"
              >
                <Languages className="w-3.5 h-3.5 text-indigo-400" />
                Translate
              </button>
              <button
                id="btn-send-to-ask"
                onClick={() => onTransferText(result.extractedText, 'ask-document')}
                className="py-2 px-1 text-center bg-slate-700/50 hover:bg-slate-700 rounded-lg text-[11px] text-slate-200 transition-colors flex flex-col items-center gap-1"
              >
                <MessageSquareQuote className="w-3.5 h-3.5 text-amber-400" />
                Ask Q&A
              </button>
            </div>
          </div>

          {/* Quick Actions (Summarize, Translate, Ask Questions, Extract Key Points, Make Notes, Find Dates/Names/Amounts) */}
          <div className="pt-2 border-t border-slate-700/60">
            <QuickActionsBar
              documentText={result.extractedText}
              documentTitle={result.summary?.slice(0, 40) || 'Scanned Document'}
              onTransferText={onTransferText}
              onSaveHistory={onSaveHistory}
            />
          </div>
        </div>
      )}
    </div>
  );
};
