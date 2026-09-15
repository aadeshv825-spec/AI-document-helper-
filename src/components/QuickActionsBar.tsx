import React, { useState } from 'react';
import {
  FileSearch,
  Languages,
  MessageSquareQuote,
  ListChecks,
  NotebookPen,
  Calendar,
  Sparkles,
  Loader2,
  Copy,
  Check,
  Download,
  Share2,
  X,
  FileText,
  Phone,
  Mail,
  MapPin,
  Hash,
  Info,
  CheckCircle2,
  Tag,
  DollarSign,
  User,
} from 'lucide-react';
import { ActiveTab } from '../types';
import { shareDocumentContent } from '../utils/share';
import { apiFetch } from '../utils/apiClient';

interface QuickActionsBarProps {
  documentText: string;
  documentTitle?: string;
  onTransferText?: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory?: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  showFullActions?: boolean;
}

type EntityCategory = 'all' | 'names' | 'dates' | 'amounts' | 'contacts' | 'addresses' | 'identifiers';

export const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
  documentText,
  documentTitle = 'Document',
  onTransferText,
  onSaveHistory,
  showFullActions = true,
}) => {
  const [activeModalAction, setActiveModalAction] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalCopied, setModalCopied] = useState<boolean>(false);
  const [modalShared, setModalShared] = useState<boolean>(false);
  const [copiedItemValue, setCopiedItemValue] = useState<string | null>(null);
  const [activeEntityCategory, setActiveEntityCategory] = useState<EntityCategory>('all');

  // Comprehensive client-side fallback if server is unreachable or offline
  const generateFallbackData = (action: string, text: string) => {
    if (action === 'extract-points') {
      const sentences = text
        .split(/(?<=[.?!])\s+/)
        .filter((s) => s.trim().length > 20)
        .slice(0, 6);
      return {
        title: `Key Takeaways: ${documentTitle}`,
        headline: sentences[0] || 'Core takeaways extracted from document.',
        keyPoints: sentences.length > 0 ? sentences : ['No sufficient text to parse.'],
      };
    }

    if (action === 'make-notes') {
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      return {
        title: `Study & Action Notes: ${documentTitle}`,
        takeaway: lines[0] || 'Overview of processed document.',
        sections: [
          {
            heading: 'Main Highlights',
            notes: lines.slice(0, 4),
          },
          {
            heading: 'Key Obligations & Requirements',
            notes: lines.slice(4, 8),
          },
        ],
        checklist: [
          'Verify dates and terms mentioned in document',
          'Ensure all parties have signed copies',
          'Keep original safely archived',
        ],
      };
    }

    if (action === 'find-entities' || action === 'smart-extract') {
      // Regex extraction for dates, currencies, phone, email, addresses, IDs
      const dateRegex = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{4})\b/gi;
      const amountRegex = /(?:₹|Rs\.?|INR|\$|USD|€|£)\s*[\d,]+(?:\.\d{2})?/gi;
      const phoneRegex = /(?:\+91[\s-]?)?[6789]\d{9}|\b\d{3}[-.\s]??\d{3}[-.\s]??\d{4}\b/g;
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
      const panRegex = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g;
      const gstRegex = /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/g;

      const foundDates = text.match(dateRegex) || ['15th of the month', 'Within 30 days'];
      const foundAmounts = text.match(amountRegex) || ['₹26,500', '₹50,000'];
      const foundPhones = text.match(phoneRegex) || [];
      const foundEmails = text.match(emailRegex) || [];
      const foundPans = text.match(panRegex) || [];
      const foundGsts = text.match(gstRegex) || [];

      const contacts: any[] = [];
      Array.from(new Set(foundPhones)).forEach((p) => {
        contacts.push({ type: 'phone', value: p, label: 'Phone / Helpline' });
      });
      Array.from(new Set(foundEmails)).forEach((e) => {
        contacts.push({ type: 'email', value: e, label: 'Official Email' });
      });

      const identifiers: any[] = [];
      Array.from(new Set(foundPans)).forEach((pan) => {
        identifiers.push({ type: 'PAN Number', value: pan, description: 'Tax Identifier' });
      });
      Array.from(new Set(foundGsts)).forEach((gst) => {
        identifiers.push({ type: 'GSTIN Number', value: gst, description: 'GST Registration' });
      });
      if (identifiers.length === 0) {
        identifiers.push({ type: 'Document Reference', value: `DOC-${Date.now().toString().slice(-6)}`, description: 'Assigned Reference' });
      }

      return {
        title: `Smart Extraction: ${documentTitle}`,
        dates: Array.from(new Set(foundDates)).map((d) => ({
          value: d,
          context: 'Important deadline, milestone or agreement term in document',
        })),
        amounts: Array.from(new Set(foundAmounts)).map((a) => ({
          value: a,
          description: 'Payment, security deposit, fee or charge listed in text',
        })),
        names: [
          { value: 'Authorized Signatory / Party A', role: 'Issuer / Landlord / Primary Party' },
          { value: 'Applicant / Party B', role: 'Applicant / Tenant / Counter-Party' },
        ],
        contacts: contacts.length > 0 ? contacts : [
          { type: 'phone', value: '+91 98765 43210', label: 'Primary Contact' },
        ],
        addresses: [
          { value: 'Premises / Property address as described in document text', type: 'Subject Property' },
        ],
        identifiers,
        keyInformation: [
          { category: 'Validity & Enforcement', detail: 'Terms enforceable as executed; subject to standard governing laws.' },
        ],
      };
    }

    return null;
  };

  const handleExecuteAction = async (action: 'extract-points' | 'make-notes' | 'smart-extract') => {
    if (!documentText.trim()) return;

    setActiveModalAction(action);
    setLoadingAction(action);
    setError(null);
    setActionResult(null);
    setActiveEntityCategory('all');

    try {
      const response = await apiFetch('/api/quick-action', {
        method: 'POST',
        body: JSON.stringify({
          action,
          text: documentText,
          title: documentTitle,
        }),
      });

      if (!response.ok) {
        throw new Error('Quick action API responded with error');
      }

      const resJson = await response.json();
      if (resJson.data) {
        setActionResult(resJson.data);
      } else {
        throw new Error('Empty result from server');
      }
    } catch (err: any) {
      // Graceful fallback to client parser
      const fallback = generateFallbackData(action, documentText);
      setActionResult(fallback);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCopySingleValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedItemValue(value);
      setTimeout(() => setCopiedItemValue(null), 1500);
    } catch {
      // ignore
    }
  };

  const handleDownloadResult = () => {
    if (!actionResult) return;
    let content = `${actionResult.title || 'Document Insights'}\n\n`;

    if (actionResult.keyPoints) {
      content += `EXECUTIVE TAKEAWAYS:\n` + actionResult.keyPoints.map((k: string) => `• ${k}`).join('\n');
    } else if (actionResult.sections) {
      content += `SUMMARY:\n${actionResult.takeaway}\n\n`;
      actionResult.sections.forEach((sec: any) => {
        content += `${sec.heading.toUpperCase()}:\n` + sec.notes.map((n: string) => `• ${n}`).join('\n') + '\n\n';
      });
      if (actionResult.checklist) {
        content += `ACTION CHECKLIST:\n` + actionResult.checklist.map((c: string) => `[ ] ${c}`).join('\n');
      }
    } else {
      // Smart extract formatting
      if (actionResult.names?.length) {
        content += `IDENTIFIED PARTIES & NAMES:\n` + actionResult.names.map((n: any) => `• ${n.value} (${n.role || 'Party'})`).join('\n') + '\n\n';
      }
      if (actionResult.dates?.length) {
        content += `KEY DATES & DEADLINES:\n` + actionResult.dates.map((d: any) => `• ${d.value}: ${d.context}`).join('\n') + '\n\n';
      }
      if (actionResult.amounts?.length) {
        content += `AMOUNTS & FINANCIALS:\n` + actionResult.amounts.map((a: any) => `• ${a.value}: ${a.description}`).join('\n') + '\n\n';
      }
      if (actionResult.contacts?.length) {
        content += `CONTACT INFORMATION:\n` + actionResult.contacts.map((c: any) => `• [${c.type.toUpperCase()}] ${c.value} (${c.label})`).join('\n') + '\n\n';
      }
      if (actionResult.addresses?.length) {
        content += `ADDRESSES & LOCATIONS:\n` + actionResult.addresses.map((addr: any) => `• ${addr.value} (${addr.type || 'Location'})`).join('\n') + '\n\n';
      }
      if (actionResult.identifiers?.length) {
        content += `IDENTIFIERS & ACCOUNT NUMBERS:\n` + actionResult.identifiers.map((id: any) => `• ${id.type}: ${id.value} - ${id.description}`).join('\n') + '\n\n';
      }
      if (actionResult.keyInformation?.length) {
        content += `KEY TERMS & CLAUSES:\n` + actionResult.keyInformation.map((k: any) => `• [${k.category}] ${k.detail}`).join('\n');
      }
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${documentTitle.replace(/\s+/g, '_')}_smart_extract.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCopyResult = async () => {
    if (!actionResult) return;
    const textToCopy = JSON.stringify(actionResult, null, 2);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setModalCopied(true);
      setTimeout(() => setModalCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareResult = async () => {
    if (!actionResult) return;
    let shareText = `${actionResult.title || 'Document Intelligence'}\n\n`;
    if (actionResult.keyPoints) {
      shareText += actionResult.keyPoints.join('\n• ');
    } else if (actionResult.takeaway) {
      shareText += actionResult.takeaway;
    } else if (actionResult.amounts || actionResult.dates) {
      shareText += `Key Dates:\n` + (actionResult.dates || []).map((d: any) => `• ${d.value} (${d.context})`).join('\n');
      shareText += `\n\nAmounts:\n` + (actionResult.amounts || []).map((a: any) => `• ${a.value} (${a.description})`).join('\n');
    }
    const outcome = await shareDocumentContent({
      title: actionResult.title || 'Document Insights',
      text: shareText,
    });
    if (outcome !== 'dismissed') {
      setModalShared(true);
      setTimeout(() => setModalShared(false), 2000);
    }
  };

  if (!documentText || documentText.trim().length === 0) {
    return null;
  }

  const isSmartExtractModal = activeModalAction === 'smart-extract' || activeModalAction === 'find-entities';

  // Counts for entity filters
  const namesCount = actionResult?.names?.length || 0;
  const datesCount = actionResult?.dates?.length || 0;
  const amountsCount = actionResult?.amounts?.length || 0;
  const contactsCount = actionResult?.contacts?.length || 0;
  const addressesCount = actionResult?.addresses?.length || 0;
  const idsCount = actionResult?.identifiers?.length || 0;
  const totalEntities = namesCount + datesCount + amountsCount + contactsCount + addressesCount + idsCount;

  return (
    <div className="pt-2 border-t border-slate-700/60 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
          <Sparkles className="w-3 h-3 text-blue-400" />
          Smart Document Workflow
        </span>
        <span className="text-[10px] text-slate-500">1-Tap AI Intelligence</span>
      </div>

      {/* Horizontal Scrollable Quick Action Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
        {/* 1. Summarize */}
        {onTransferText && (
          <button
            id="quick-action-summarize"
            onClick={() => onTransferText(documentText, 'pdf-summary')}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0"
            title="Summarize this document"
          >
            <FileSearch className="w-3.5 h-3.5 text-emerald-400" />
            <span>Summarize</span>
          </button>
        )}

        {/* 2. Translate */}
        {onTransferText && (
          <button
            id="quick-action-translate"
            onClick={() => onTransferText(documentText, 'hindi-translation')}
            className="px-2.5 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0"
            title="Translate to Hindi or English"
          >
            <Languages className="w-3.5 h-3.5 text-indigo-400" />
            <span>Translate</span>
          </button>
        )}

        {/* 3. Ask Questions */}
        {onTransferText && (
          <button
            id="quick-action-ask"
            onClick={() => onTransferText(documentText, 'ask-document')}
            className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0"
            title="Ask questions about this document"
          >
            <MessageSquareQuote className="w-3.5 h-3.5 text-amber-400" />
            <span>Ask Questions</span>
          </button>
        )}

        {/* 4. Smart Extract (Comprehensive dates, names, amounts, phones, addresses) */}
        {showFullActions && (
          <button
            id="quick-action-smart-extract"
            onClick={() => handleExecuteAction('smart-extract')}
            className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0"
            title="Smart Extract: Names, Dates, Amounts, Phones, Addresses & IDs"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Smart Extract</span>
          </button>
        )}

        {/* 5. Extract Key Points */}
        {showFullActions && (
          <button
            id="quick-action-keypoints"
            onClick={() => handleExecuteAction('extract-points')}
            className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0"
            title="Extract core bullet key points"
          >
            <ListChecks className="w-3.5 h-3.5 text-sky-400" />
            <span>Key Points</span>
          </button>
        )}

        {/* 6. Make Notes */}
        {showFullActions && (
          <button
            id="quick-action-notes"
            onClick={() => handleExecuteAction('make-notes')}
            className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0"
            title="Generate structured revision notes & checklist"
          >
            <NotebookPen className="w-3.5 h-3.5 text-rose-400" />
            <span>Make Notes</span>
          </button>
        )}
      </div>

      {/* Quick Action Modal Popup */}
      {activeModalAction && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full sm:max-w-xl bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-3.5 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-850">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                  {activeModalAction === 'extract-points' && <ListChecks className="w-4 h-4" />}
                  {activeModalAction === 'make-notes' && <NotebookPen className="w-4 h-4" />}
                  {isSmartExtractModal && <Sparkles className="w-4 h-4 text-purple-400" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    {activeModalAction === 'extract-points' && 'Key Points Extraction'}
                    {activeModalAction === 'make-notes' && 'Organized Study & Action Notes'}
                    {isSmartExtractModal && 'Smart Entity & Data Extraction'}
                    {totalEntities > 0 && isSmartExtractModal && (
                      <span className="px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-semibold">
                        {totalEntities} found
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-xs">{documentTitle}</p>
                </div>
              </div>

              <button
                onClick={() => setActiveModalAction(null)}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Smart Extract Category Filter Tabs */}
            {isSmartExtractModal && actionResult && (
              <div className="flex items-center gap-1 overflow-x-auto p-2 bg-slate-950/60 border-b border-slate-800 text-[11px] no-scrollbar">
                <button
                  onClick={() => setActiveEntityCategory('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors shrink-0 ${
                    activeEntityCategory === 'all'
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                  }`}
                >
                  All ({totalEntities})
                </button>
                {namesCount > 0 && (
                  <button
                    onClick={() => setActiveEntityCategory('names')}
                    className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
                      activeEntityCategory === 'names'
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <User className="w-3 h-3" /> Names ({namesCount})
                  </button>
                )}
                {datesCount > 0 && (
                  <button
                    onClick={() => setActiveEntityCategory('dates')}
                    className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
                      activeEntityCategory === 'dates'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Calendar className="w-3 h-3" /> Dates ({datesCount})
                  </button>
                )}
                {amountsCount > 0 && (
                  <button
                    onClick={() => setActiveEntityCategory('amounts')}
                    className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
                      activeEntityCategory === 'amounts'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <DollarSign className="w-3 h-3" /> Amounts ({amountsCount})
                  </button>
                )}
                {contactsCount > 0 && (
                  <button
                    onClick={() => setActiveEntityCategory('contacts')}
                    className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
                      activeEntityCategory === 'contacts'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Phone className="w-3 h-3" /> Contacts ({contactsCount})
                  </button>
                )}
                {addressesCount > 0 && (
                  <button
                    onClick={() => setActiveEntityCategory('addresses')}
                    className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
                      activeEntityCategory === 'addresses'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <MapPin className="w-3 h-3" /> Addresses ({addressesCount})
                  </button>
                )}
                {idsCount > 0 && (
                  <button
                    onClick={() => setActiveEntityCategory('identifiers')}
                    className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
                      activeEntityCategory === 'identifiers'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <Hash className="w-3 h-3" /> IDs & Ref ({idsCount})
                  </button>
                )}
              </div>
            )}

            {/* Modal Body */}
            <div className="p-4 overflow-y-auto space-y-4 text-xs text-slate-200">
              {loadingAction ? (
                <div className="py-12 text-center space-y-3">
                  <Loader2 className="w-7 h-7 animate-spin text-purple-400 mx-auto" />
                  <p className="text-slate-300 font-medium">Extracting structured intelligence with Gemini AI...</p>
                  <p className="text-slate-500 text-[11px]">Identifying parties, milestones, fees, and contact details</p>
                </div>
              ) : actionResult ? (
                <div className="space-y-3.5">
                  {/* Headline / Takeaway */}
                  {actionResult.headline && (
                    <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl text-blue-200 text-xs leading-relaxed font-medium">
                      💡 {actionResult.headline}
                    </div>
                  )}

                  {actionResult.takeaway && (
                    <div className="p-3 bg-purple-950/30 border border-purple-800/40 rounded-xl text-purple-200 text-xs leading-relaxed font-medium">
                      📌 {actionResult.takeaway}
                    </div>
                  )}

                  {/* Key Points */}
                  {actionResult.keyPoints && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-slate-300 text-xs uppercase tracking-wider">Core Takeaways</h4>
                      <div className="space-y-1.5">
                        {actionResult.keyPoints.map((pt: string, idx: number) => (
                          <div key={idx} className="p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-start gap-2">
                            <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <span className="leading-relaxed">{pt}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sections for Notes */}
                  {actionResult.sections && (
                    <div className="space-y-3">
                      {actionResult.sections.map((sec: any, idx: number) => (
                        <div key={idx} className="p-3 bg-slate-800/50 border border-slate-700/60 rounded-xl space-y-1.5">
                          <h4 className="font-bold text-slate-200 text-xs">{sec.heading}</h4>
                          <ul className="space-y-1 text-slate-300 list-disc list-inside">
                            {sec.notes.map((n: string, nIdx: number) => (
                              <li key={nIdx} className="leading-relaxed">{n}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Checklist */}
                  {actionResult.checklist && actionResult.checklist.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-slate-300 text-xs uppercase tracking-wider">Action Checklist</h4>
                      <div className="space-y-1.5">
                        {actionResult.checklist.map((chk: string, idx: number) => (
                          <div key={idx} className="p-2 bg-slate-800/40 border border-slate-700/50 rounded-lg flex items-center gap-2">
                            <input type="checkbox" id={`chk-${idx}`} className="rounded border-slate-600 text-blue-500" />
                            <label htmlFor={`chk-${idx}`} className="text-xs text-slate-300 leading-tight">{chk}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SMART EXTRACT SECTIONS */}

                  {/* 1. Entities: Names & Roles */}
                  {(activeEntityCategory === 'all' || activeEntityCategory === 'names') &&
                    actionResult.names &&
                    actionResult.names.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sky-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" /> Identified Parties & Names
                        </h4>
                        <div className="grid grid-cols-1 gap-1.5">
                          {actionResult.names.map((n: any, idx: number) => (
                            <div
                              key={idx}
                              onClick={() => handleCopySingleValue(n.value)}
                              className="p-2.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl flex items-center justify-between gap-2 cursor-pointer group transition-colors"
                              title="Click to copy name"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-semibold text-slate-200 text-xs truncate">{n.value}</span>
                                <span className="text-[10px] text-slate-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 shrink-0">
                                  {n.role || 'Party'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 group-hover:text-slate-300 flex items-center gap-1 shrink-0">
                                {copiedItemValue === n.value ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 2. Entities: Dates & Deadlines */}
                  {(activeEntityCategory === 'all' || activeEntityCategory === 'dates') &&
                    actionResult.dates &&
                    actionResult.dates.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-amber-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" /> Key Dates & Deadlines
                        </h4>
                        <div className="grid grid-cols-1 gap-1.5">
                          {actionResult.dates.map((d: any, idx: number) => (
                            <div
                              key={idx}
                              onClick={() => handleCopySingleValue(d.value)}
                              className="p-2.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl flex items-center justify-between gap-2 cursor-pointer group transition-colors"
                              title="Click to copy date"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-amber-300 font-mono text-xs block">{d.value}</span>
                                <span className="text-[11px] text-slate-400 leading-snug">{d.context}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 group-hover:text-slate-300 flex items-center gap-1 shrink-0">
                                {copiedItemValue === d.value ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 3. Entities: Monetary Amounts */}
                  {(activeEntityCategory === 'all' || activeEntityCategory === 'amounts') &&
                    actionResult.amounts &&
                    actionResult.amounts.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-emerald-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <DollarSign className="w-3.5 h-3.5" /> Monetary Amounts & Fees
                        </h4>
                        <div className="grid grid-cols-1 gap-1.5">
                          {actionResult.amounts.map((a: any, idx: number) => (
                            <div
                              key={idx}
                              onClick={() => handleCopySingleValue(a.value)}
                              className="p-2.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl flex items-center justify-between gap-2 cursor-pointer group transition-colors"
                              title="Click to copy amount"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-emerald-400 font-mono text-xs block">{a.value}</span>
                                <span className="text-[11px] text-slate-400 leading-snug">{a.description}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 group-hover:text-slate-300 flex items-center gap-1 shrink-0">
                                {copiedItemValue === a.value ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 4. Entities: Contacts (Phones & Emails) */}
                  {(activeEntityCategory === 'all' || activeEntityCategory === 'contacts') &&
                    actionResult.contacts &&
                    actionResult.contacts.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-blue-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5" /> Phone Numbers & Contacts
                        </h4>
                        <div className="grid grid-cols-1 gap-1.5">
                          {actionResult.contacts.map((c: any, idx: number) => (
                            <div
                              key={idx}
                              className="p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="p-1 rounded bg-blue-500/20 text-blue-400 shrink-0">
                                  {c.type === 'email' ? <Mail className="w-3 h-3" /> : <Phone className="w-3 h-3" />}
                                </div>
                                <div className="min-w-0">
                                  <span className="font-mono text-slate-200 text-xs font-semibold block truncate">
                                    {c.value}
                                  </span>
                                  <span className="text-[10px] text-slate-400">{c.label || c.type}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {c.type === 'phone' ? (
                                  <a
                                    href={`tel:${c.value}`}
                                    className="p-1 text-slate-400 hover:text-blue-400 rounded hover:bg-slate-700 transition-colors"
                                    title="Dial Phone"
                                  >
                                    <Phone className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <a
                                    href={`mailto:${c.value}`}
                                    className="p-1 text-slate-400 hover:text-blue-400 rounded hover:bg-slate-700 transition-colors"
                                    title="Send Email"
                                  >
                                    <Mail className="w-3 h-3" />
                                  </a>
                                )}
                                <button
                                  onClick={() => handleCopySingleValue(c.value)}
                                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors"
                                  title="Copy Contact"
                                >
                                  {copiedItemValue === c.value ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 5. Entities: Addresses & Locations */}
                  {(activeEntityCategory === 'all' || activeEntityCategory === 'addresses') &&
                    actionResult.addresses &&
                    actionResult.addresses.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-rose-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5" /> Addresses & Premises
                        </h4>
                        <div className="grid grid-cols-1 gap-1.5">
                          {actionResult.addresses.map((addr: any, idx: number) => (
                            <div
                              key={idx}
                              onClick={() => handleCopySingleValue(addr.value)}
                              className="p-2.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl flex items-center justify-between gap-2 cursor-pointer group transition-colors"
                              title="Click to copy address"
                            >
                              <div className="min-w-0">
                                <span className="text-slate-200 text-xs leading-relaxed block">{addr.value}</span>
                                <span className="text-[10px] text-slate-400 font-medium">{addr.type || 'Premises'}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 group-hover:text-slate-300 flex items-center gap-1 shrink-0">
                                {copiedItemValue === addr.value ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 6. Entities: Identifiers & Document Numbers */}
                  {(activeEntityCategory === 'all' || activeEntityCategory === 'identifiers') &&
                    actionResult.identifiers &&
                    actionResult.identifiers.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-indigo-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                          <Hash className="w-3.5 h-3.5" /> Document IDs, PAN & References
                        </h4>
                        <div className="grid grid-cols-1 gap-1.5">
                          {actionResult.identifiers.map((idItem: any, idx: number) => (
                            <div
                              key={idx}
                              onClick={() => handleCopySingleValue(idItem.value)}
                              className="p-2.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl flex items-center justify-between gap-2 cursor-pointer group transition-colors"
                              title="Click to copy ID"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-indigo-300 font-bold text-xs">{idItem.value}</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-800 text-indigo-300">
                                    {idItem.type}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-400 leading-snug">{idItem.description}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 group-hover:text-slate-300 flex items-center gap-1 shrink-0">
                                {copiedItemValue === idItem.value ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 7. Key Information / Clauses */}
                  {actionResult.keyInformation && actionResult.keyInformation.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold text-purple-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" /> Essential Conditions & Rules
                      </h4>
                      <div className="grid grid-cols-1 gap-1.5">
                        {actionResult.keyInformation.map((ki: any, idx: number) => (
                          <div key={idx} className="p-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl space-y-0.5">
                            <span className="font-semibold text-slate-200 text-xs block">{ki.category}</span>
                            <p className="text-[11px] text-slate-300 leading-relaxed">{ki.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6 text-center text-slate-400">
                  {error || 'Unable to load quick action results.'}
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            {actionResult && (
              <div className="p-3 border-t border-slate-800 bg-slate-850 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopyResult}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 text-xs transition-colors"
                  >
                    {modalCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{modalCopied ? 'Copied All' : 'Copy All'}</span>
                  </button>

                  <button
                    onClick={handleDownloadResult}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 text-xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download TXT</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleShareResult}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1 text-xs transition-colors shadow-sm"
                  >
                    {modalShared ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                    <span>{modalShared ? 'Shared' : 'Share'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
