import React, { useState, useEffect } from 'react';
import {
  FileSearch,
  Upload,
  Copy,
  Check,
  Sparkles,
  Calendar,
  CheckSquare,
  MessageSquareQuote,
  RefreshCw,
  AlertCircle,
  FileText,
  Bookmark,
  Share2,
  Star,
  Download,
} from 'lucide-react';
import { PdfSummaryResponse, ActiveTab } from '../types';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';
import { shareDocumentContent } from '../utils/share';
import { downloadTextFile } from '../utils/download';
import { QuickActionsBar } from './QuickActionsBar';
import { apiFetch } from '../utils/apiClient';

interface PdfSummaryProps {
  initialText?: string;
  onTransferText: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

export const PdfSummaryTool: React.FC<PdfSummaryProps> = ({
  initialText = '',
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [docText, setDocText] = useState<string>(
    initialText && !initialText.startsWith('data:image/') ? initialText : ''
  );
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState<string>('Document');
  const [targetLang, setTargetLang] = useState<'English' | 'Hindi'>('English');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [summaryData, setSummaryData] = useState<PdfSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [shared, setShared] = useState<boolean>(false);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [checkedActions, setCheckedActions] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (initialText && !initialText.startsWith('data:image/')) {
      setDocText(initialText);
      setPdfBase64(null);
    }
  }, [initialText]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDocTitle(file.name.replace(/\.[^/.]+$/, ''));
    setError(null);
    setSummaryData(null);

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64String = reader.result as string;
        setPdfBase64(base64String);
        setDocText(`[PDF Attached: ${file.name} - ${(file.size / 1024).toFixed(1)} KB]`);
      };
      reader.readAsDataURL(file);
    } else {
      setPdfBase64(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setDocText(content || '');
      };
      reader.readAsText(file);
    }
  };

  const handleLoadPreset = (presetId: string) => {
    const found = SAMPLE_DOCUMENTS.find((d) => d.id === presetId);
    if (found) {
      setDocTitle(found.title);
      setDocText(found.text);
      setPdfBase64(null);
      setSummaryData(null);
      setError(null);
    }
  };

  const handleSummarize = async () => {
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    if (!docText.trim() && !pdfBase64) {
      setError('Please provide document text or upload a PDF file to summarize');
      return;
    }

    setIsLoading(true);
    setError(null);
    setCheckedActions({});

    try {
      const payload: Record<string, any> = {
        title: docTitle,
        language: targetLang,
      };

      if (pdfBase64) {
        payload.fileBase64 = pdfBase64;
        payload.mimeType = 'application/pdf';
        payload.documentText = docText;
      } else {
        payload.documentText = docText;
      }

      const res = await apiFetch('/api/pdf-summary', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned ${res.status}`);
      }

      const data: PdfSummaryResponse = await res.json();
      setSummaryData(data);

      onSaveHistory(
        data.title || 'PDF Summary',
        'pdf-summary',
        `${data.summary}\n\nKey Points:\n${data.keyPoints?.join('\n')}`
      );
    } catch (err: any) {
      setError(err.message || 'Failed to summarize document');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySummary = () => {
    if (!summaryData) return;
    const formatted = `=== ${summaryData.title} ===\n\n${summaryData.summary}\n\nKEY HIGHLIGHTS:\n${summaryData.keyPoints.map((p) => `• ${p}`).join('\n')}\n\nACTION ITEMS:\n${summaryData.actionItems.map((a) => `[ ] ${a}`).join('\n')}`;
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareSummary = async () => {
    if (!summaryData) return;
    const formatted = `=== ${summaryData.title} ===\n\n${summaryData.summary}\n\nKEY HIGHLIGHTS:\n${summaryData.keyPoints.map((p) => `• ${p}`).join('\n')}\n\nACTION ITEMS:\n${summaryData.actionItems.map((a) => `[ ] ${a}`).join('\n')}`;
    const outcome = await shareDocumentContent({
      title: summaryData.title || 'Document Summary',
      text: formatted,
    });
    if (outcome !== 'dismissed') {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  const handleDownloadSummary = () => {
    if (!summaryData) return;
    const formatted = `# ${summaryData.title}\n\n## Executive Summary\n${summaryData.summary}\n\n## Key Highlights\n${summaryData.keyPoints.map((p) => `- ${p}`).join('\n')}\n\n## Action Items\n${summaryData.actionItems.map((a) => `- [ ] ${a}`).join('\n')}\n\n## Important Dates & Numbers\n${(summaryData.importantDatesOrNumbers || []).map((d) => `- ${d}`).join('\n')}`;
    downloadTextFile(
      formatted,
      `${(summaryData.title || 'Summary').replace(/[^a-zA-Z0-9_-]/g, '_')}.md`,
      'text/markdown;charset=utf-8'
    );
  };

  const toggleAction = (idx: number) => {
    setCheckedActions((prev) => ({ ...prev, [idx]: !prev[idx] }));
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

      {/* Input Box Card */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <FileSearch className="w-4 h-4 text-emerald-400" />
            PDF & Document Summarizer
          </h2>
          <label
            htmlFor="pdf-file-upload"
            className="cursor-pointer text-[11px] font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-950/40 border border-emerald-800/40 px-2 py-1 rounded-lg transition-colors"
          >
            <Upload className="w-3 h-3" />
            Import File
          </label>
          <input
            id="pdf-file-upload"
            type="file"
            accept=".txt,.pdf,.doc,.docx,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {/* Quick Sample Selector */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-slate-400 mr-1">Load sample:</span>
          {SAMPLE_DOCUMENTS.map((doc) => (
            <button
              key={doc.id}
              onClick={() => handleLoadPreset(doc.id)}
              className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white transition-colors"
            >
              {doc.title.split(' ')[0]} {doc.title.split(' ')[1] || ''}
            </button>
          ))}
        </div>

        {/* Document Textarea */}
        <div className="relative">
          <textarea
            id="pdf-summary-textarea"
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            placeholder="Paste agreement text, email thread, official notice, or report here..."
            rows={5}
            className="w-full bg-slate-900/90 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-sans leading-relaxed resize-none"
          />
          {docText && (
            <span className="absolute bottom-2 right-2 text-[10px] text-slate-500 bg-slate-900/80 px-1.5 py-0.5 rounded">
              {docText.length} chars
            </span>
          )}
        </div>

        {/* Language & Action Button */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Language:</span>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as 'English' | 'Hindi')}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none"
            >
              <option value="English">English</option>
              <option value="Hindi">हिन्दी (Hindi)</option>
            </select>
          </div>

          <button
            id="btn-run-summary"
            onClick={handleSummarize}
            disabled={isLoading || !docText.trim()}
            className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/60 text-white font-medium text-xs rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Summarizing...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Summarize Document
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/60 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Output */}
      {summaryData && (
        <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 space-y-4 shadow-sm">
          {/* Header & Controls */}
          <div className="flex items-start justify-between gap-2 border-b border-slate-700/60 pb-3">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 block mb-0.5">
                Executive Brief
              </span>
              <h3 className="text-sm font-bold text-slate-100 leading-snug">
                {summaryData.title}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                id="btn-copy-summary"
                onClick={handleCopySummary}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Copy summary"
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
                id="btn-share-summary"
                onClick={handleShareSummary}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Share summary via Web Share"
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
                id="btn-download-summary"
                onClick={handleDownloadSummary}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Download markdown summary"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>

              <button
                id="btn-favorite-summary"
                onClick={() => {
                  const nextFav = !isFavorited;
                  setIsFavorited(nextFav);
                  if (summaryData) {
                    onSaveHistory(
                      summaryData.title || 'PDF Summary',
                      'pdf-summary',
                      summaryData.summary,
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

          {/* Core Summary Paragraph */}
          <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-lg text-xs text-slate-200 leading-relaxed">
            {summaryData.summary}
          </div>

          {/* Key Bullet Highlights */}
          {summaryData.keyPoints && summaryData.keyPoints.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
                Key Highlights
              </span>
              <ul className="space-y-1.5">
                {summaryData.keyPoints.map((point, idx) => (
                  <li
                    key={idx}
                    className="p-2 bg-slate-900/40 border border-slate-800/80 rounded-lg text-xs text-slate-300 flex items-start gap-2 leading-relaxed"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Items with Checkboxes */}
          {summaryData.actionItems && summaryData.actionItems.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                Action Items (Tap to check)
              </span>
              <div className="space-y-1.5">
                {summaryData.actionItems.map((action, idx) => {
                  const isChecked = !!checkedActions[idx];
                  return (
                    <div
                      key={idx}
                      onClick={() => toggleAction(idx)}
                      className={`p-2 rounded-lg border text-xs flex items-center gap-2.5 cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-slate-400 line-through'
                          : 'bg-slate-900/50 border-slate-800 text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleAction(idx)}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                      />
                      <span className="leading-tight">{action}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dates & Numbers */}
          {summaryData.importantDatesOrNumbers &&
            summaryData.importantDatesOrNumbers.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  Key Dates & Numbers
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {summaryData.importantDatesOrNumbers.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-amber-200/90 font-mono"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Smooth Transfer to Ask Document */}
          <div className="pt-2 border-t border-slate-700/60">
            <button
              id="btn-ask-about-this-doc"
              onClick={() => onTransferText(docText, 'ask-document')}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <MessageSquareQuote className="w-4 h-4 text-amber-400" />
              Ask questions about this document
            </button>
          </div>

          {/* Quick Actions (Summarize, Translate, Ask Questions, Extract Key Points, Make Notes, Find Dates/Names/Amounts) */}
          <div className="pt-2 border-t border-slate-700/60">
            <QuickActionsBar
              documentText={docText}
              documentTitle={summaryData.title || 'Document Summary'}
              onTransferText={onTransferText}
              onSaveHistory={onSaveHistory}
            />
          </div>
        </div>
      )}
    </div>
  );
};
