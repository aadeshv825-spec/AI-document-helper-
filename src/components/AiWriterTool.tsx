import React, { useState, useEffect } from 'react';
import {
  PenTool,
  Copy,
  Check,
  Download,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Lightbulb,
  FileCheck,
  Share2,
  Star,
  FileText,
  Mail,
  Briefcase,
  AlertTriangle,
  FolderOpen,
} from 'lucide-react';
import { AiWriterResponse, ActiveTab } from '../types';
import { shareDocumentContent } from '../utils/share';
import { apiFetch } from '../utils/apiClient';
import { QuickActionsBar } from './QuickActionsBar';

interface AiWriterProps {
  initialText?: string;
  onTransferText?: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

type TemplateCategory = 'all' | 'applications' | 'letters' | 'resumes' | 'emails' | 'reports';

interface TemplateItem {
  id: string;
  name: string;
  category: TemplateCategory;
  docType: string;
  recipient: string;
  defaultTopic: string;
  defaultPoints: string;
}

const TEMPLATES: TemplateItem[] = [
  // Applications
  {
    id: 'leave-app',
    name: 'Leave Application',
    category: 'applications',
    docType: 'Leave Application',
    recipient: 'Principal / Department Manager',
    defaultTopic: 'Sick Leave / Urgent Personal Leave for 3 days',
    defaultPoints: 'High fever and doctor advised 3 days rest from Monday to Wednesday. Pending tasks handed over to teammate.',
  },
  {
    id: 'bank-letter',
    name: 'Bank Branch Request',
    category: 'applications',
    docType: 'Bank Application',
    recipient: 'The Branch Manager',
    defaultTopic: 'Request for New Debit Card & Address Updation',
    defaultPoints: 'Previous card expired; updated residential address with Aadhaar copy attached; request dispatch to new address.',
  },
  {
    id: 'college-tc',
    name: 'College TC / Bonafide',
    category: 'applications',
    docType: 'Academic Application',
    recipient: 'The Dean / Principal',
    defaultTopic: 'Application for Transfer Certificate (TC) and Bonafide',
    defaultPoints: 'Completed B.Tech/Degree program; all dues cleared from library and hostel; need TC for higher studies admission.',
  },
  {
    id: 'rti-application',
    name: 'RTI Application',
    category: 'applications',
    docType: 'Right to Information (RTI) Application',
    recipient: 'Public Information Officer (PIO)',
    defaultTopic: 'Information regarding road repair budget and delay in Sector 14',
    defaultPoints: 'Seeking certified copies of work order, contractor details, completion deadline, and penalty clauses for non-completion.',
  },

  // Letters
  {
    id: 'rent-notice',
    name: 'Tenant Vacating Notice',
    category: 'letters',
    docType: 'Tenancy Notice',
    recipient: 'Landlord / Property Owner',
    defaultTopic: '1-Month Advance Notice for Vacating Premises',
    defaultPoints: 'Completed 11 months tenancy; job transfer; vacating on 31st of next month; request security deposit refund inspection.',
  },
  {
    id: 'complaint',
    name: 'Official Grievance / Complaint',
    category: 'letters',
    docType: 'Formal Complaint Letter',
    recipient: 'Municipal Commissioner / RWA Secretary',
    defaultTopic: 'Urgent Complaint Regarding Streetlight & Water Contamination',
    defaultPoints: 'Streetlights non-functional for past 10 days in Block C; drinking water has sediment; request prompt inspection and restoration.',
  },
  {
    id: 'job-cover',
    name: 'Job Cover Letter',
    category: 'letters',
    docType: 'Employment Cover Letter',
    recipient: 'Hiring Manager',
    defaultTopic: 'Application for Senior Developer / Project Manager Role',
    defaultPoints: '5 years experience; increased product efficiency by 35%; led team of 6 engineers; excited to join your high-growth company.',
  },
  {
    id: 'resignation',
    name: 'Formal Resignation Letter',
    category: 'letters',
    docType: 'Resignation Letter',
    recipient: 'Reporting Manager & HR Department',
    defaultTopic: 'Notice of Resignation and Service Transition',
    defaultPoints: 'Resigning to pursue new career opportunities; serving standard 30-day notice period; committed to clean handover.',
  },
  {
    id: 'salary-hike',
    name: 'Salary Revision / Promotion',
    category: 'letters',
    docType: 'Compensation Review Request',
    recipient: 'Department Head / VP of Engineering',
    defaultTopic: 'Annual Compensation and Role Revision Request',
    defaultPoints: 'Delivered 3 major client releases ahead of schedule; took on mentoring responsibilities; requesting salary realignment with market rates.',
  },

  // Resumes
  {
    id: 'resume-summary',
    name: 'Resume Executive Summary',
    category: 'resumes',
    docType: 'Curriculum Vitae / Resume Summary',
    recipient: 'Prospective Employers',
    defaultTopic: 'Professional Profile for Full-Stack Tech Lead',
    defaultPoints: 'Architecting scalable cloud microservices, TypeScript, Node.js, AI integrations; track record of 99.9% uptime and agile leadership.',
  },
  {
    id: 'resume-experience',
    name: 'Resume Experience Bullet Points',
    category: 'resumes',
    docType: 'Work Experience Section',
    recipient: 'Resume Reviewers',
    defaultTopic: 'Key Career Achievements & Metrics-driven Experience',
    defaultPoints: 'Reduced server latency by 40%; automated document OCR pipeline saving 20 hours/week; collaborated cross-functionally across 4 time zones.',
  },

  // Emails
  {
    id: 'client-followup',
    name: 'Client Proposal Follow-up',
    category: 'emails',
    docType: 'Professional Business Email',
    recipient: 'Prospective Client / Account Executive',
    defaultTopic: 'Follow-up on Proposed Project Scope and Milestones',
    defaultPoints: 'Checking in on last Tuesday discussion; attached revised fee structure and timeline; available for 15-min alignment call.',
  },
  {
    id: 'delay-apology',
    name: 'Formal Clarification / Delay Notice',
    category: 'emails',
    docType: 'Formal Business Email',
    recipient: 'Stakeholders / Project Committee',
    defaultTopic: 'Project Milestone Update & Schedule Realignment',
    defaultPoints: 'Unanticipated third-party API outage delayed testing phase by 3 business days; updated target launch date is next Thursday with no budget change.',
  },

  // Reports
  {
    id: 'incident-report',
    name: 'Incident / Inspection Report',
    category: 'reports',
    docType: 'Formal Incident Report',
    recipient: 'Operations Director & Safety Officer',
    defaultTopic: 'Server Downtime / Facility Equipment Incident Report',
    defaultPoints: 'Occurred at 14:30 hrs; root cause was power fluctuation in rack B; failover triggered; full service restored in 22 mins; preventive UPS replacement recommended.',
  },
  {
    id: 'noc-affidavit',
    name: 'NOC / Affidavit Outline',
    category: 'reports',
    docType: 'Declaration / No Objection Certificate',
    recipient: 'Concerned Authority / Verification Officer',
    defaultTopic: 'No Objection Certificate for Vehicle Transfer / Name Correction',
    defaultPoints: 'Declarant has no objection to transfer of ownership; no pending hypothecation or legal claims against said property.',
  },
];

export const AiWriterTool: React.FC<AiWriterProps> = ({
  initialText,
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('leave-app');
  const [docType, setDocType] = useState<string>('Leave Application');
  const [recipient, setRecipient] = useState<string>('Principal / Department Manager');
  const [topic, setTopic] = useState<string>('Sick Leave / Urgent Personal Leave for 3 days');
  const [keyPoints, setKeyPoints] = useState<string>(
    initialText && !initialText.startsWith('data:image/')
      ? initialText.slice(0, 1000)
      : 'High fever and doctor advised 3 days rest. Pending tasks handed over.'
  );
  const [tone, setTone] = useState<string>('Formal & Respectful');
  const [language, setLanguage] = useState<'English' | 'Hindi'>('English');

  useEffect(() => {
    if (initialText && !initialText.startsWith('data:image/')) {
      setKeyPoints(initialText.slice(0, 1000));
    }
  }, [initialText]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [draftResult, setDraftResult] = useState<AiWriterResponse | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [shared, setShared] = useState<boolean>(false);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);

  const filteredTemplates = TEMPLATES.filter(
    (t) => selectedCategory === 'all' || t.category === selectedCategory
  );

  const handleSelectTemplate = (tempId: string) => {
    setSelectedTemplate(tempId);
    const t = TEMPLATES.find((item) => item.id === tempId);
    if (t) {
      setDocType(t.docType);
      setRecipient(t.recipient);
      setTopic(t.defaultTopic);
      setKeyPoints(t.defaultPoints);
    }
  };

  const handleGenerate = async () => {
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    setIsLoading(true);
    setError(null);
    setDraftResult(null);

    try {
      const response = await apiFetch('/api/ai-writer', {
        method: 'POST',
        body: JSON.stringify({
          docType,
          topic,
          keyPoints,
          recipient,
          tone,
          language,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          onOpenPro?.();
          return;
        }
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to draft document');
      }

      const data: AiWriterResponse = await response.json();
      setDraftResult(data);
      setEditedContent(data.content);

      onSaveHistory(
        data.title || `${docType}: ${topic.slice(0, 25)}`,
        'ai-writer',
        data.content,
        false
      );
    } catch (err: any) {
      setError(err.message || 'Error communicating with AI writer service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!editedContent) return;
    try {
      await navigator.clipboard.writeText(editedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleShare = async () => {
    if (!editedContent) return;
    const outcome = await shareDocumentContent({
      title: draftResult?.title || 'Drafted Document',
      text: editedContent,
    });
    if (outcome !== 'dismissed') {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!editedContent) return;
    const blob = new Blob([editedContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draftResult?.title || docType || 'Document').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Top Banner */}
      <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400">
              <PenTool className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">AI Document & Letter Writer</h2>
              <p className="text-xs text-slate-400">
                Draft professional applications, notices, resumes, emails, and reports with proper formatting
              </p>
            </div>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30">
            {TEMPLATES.length} Ready Templates
          </span>
        </div>

        {/* Template Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs border-b border-slate-700/60 pt-1">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors shrink-0 ${
              selectedCategory === 'all'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            All Templates ({TEMPLATES.length})
          </button>
          <button
            onClick={() => setSelectedCategory('applications')}
            className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
              selectedCategory === 'applications'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <FileCheck className="w-3.5 h-3.5" /> Applications
          </button>
          <button
            onClick={() => setSelectedCategory('letters')}
            className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
              selectedCategory === 'letters'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <Mail className="w-3.5 h-3.5" /> Letters & Notices
          </button>
          <button
            onClick={() => setSelectedCategory('resumes')}
            className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
              selectedCategory === 'resumes'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" /> Resumes & CVs
          </button>
          <button
            onClick={() => setSelectedCategory('emails')}
            className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
              selectedCategory === 'emails'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <Mail className="w-3.5 h-3.5" /> Business Emails
          </button>
          <button
            onClick={() => setSelectedCategory('reports')}
            className={`px-3 py-1 rounded-lg font-medium flex items-center gap-1 transition-colors shrink-0 ${
              selectedCategory === 'reports'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Reports & Legal
          </button>
        </div>

        {/* Template Quick Selection Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar">
          {filteredTemplates.map((t) => (
            <button
              key={t.id}
              onClick={() => handleSelectTemplate(t.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 border ${
                selectedTemplate === t.id
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-xs'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700/60 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        {/* Input Form Fields */}
        <div className="space-y-2.5 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                Recipient / Addressed Authority:
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="e.g. Branch Manager / Principal / Landlord / HR"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                Document Type:
              </label>
              <input
                type="text"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                placeholder="e.g. Formal Application, Tenancy Notice, Cover Letter"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              Subject / Core Purpose:
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Sick Leave for 3 days due to viral fever"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">
              Key Details / Specific Information to Include:
            </label>
            <textarea
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              rows={2}
              placeholder="e.g. Dates, reason, account numbers, contact details, handover notes..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500 resize-none leading-relaxed"
            />
          </div>

          {/* Tone & Language Selectors */}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1 font-medium">Tone:</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              >
                <option value="Formal & Respectful">Formal & Respectful</option>
                <option value="Urgent & Firm">Urgent & Firm</option>
                <option value="Polite Request">Polite Request</option>
                <option value="Crisp & Executive">Crisp & Executive</option>
                <option value="Legal & Official">Legal & Official</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1 font-medium">Language:</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'English' | 'Hindi')}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
              >
                <option value="English">English</option>
                <option value="Hindi">हिन्दी (Hindi)</option>
              </select>
            </div>
          </div>

          <button
            id="btn-draft-document"
            onClick={handleGenerate}
            disabled={isLoading || !topic.trim()}
            className="w-full mt-2 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900/60 text-white font-medium text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Drafting document with Gemini AI...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Draft Document Now
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

      {/* Generated Output Card */}
      {draftResult && (
        <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                {draftResult.title}
              </span>
              <span className="text-[10px] text-slate-400">
                Tap inside text to edit directly before saving or exporting
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                id="btn-copy-draft"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Copy to clipboard"
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
                id="btn-share-draft"
                onClick={handleShare}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Share document via Web Share"
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
                id="btn-download-draft"
                onClick={handleDownload}
                className="p-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                title="Download as .txt"
              >
                <Download className="w-4 h-4" />
              </button>

              <button
                id="btn-favorite-draft"
                onClick={() => {
                  const nextFav = !isFavorited;
                  setIsFavorited(nextFav);
                  if (draftResult) {
                    onSaveHistory(
                      draftResult.title || `${docType}: ${topic.slice(0, 25)}`,
                      'ai-writer',
                      editedContent,
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

          {/* Direct Editable Text Area */}
          <textarea
            id="draft-content-editable"
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            rows={12}
            className="w-full bg-slate-900 rounded-lg border border-slate-800 p-3 text-xs text-slate-100 font-mono leading-relaxed focus:outline-none focus:border-rose-500 resize-y"
          />

          {/* Helpful Filing Tips */}
          {draftResult.tips && draftResult.tips.length > 0 && (
            <div className="p-3 bg-amber-950/20 border border-amber-900/40 rounded-lg space-y-1 text-xs">
              <span className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                <Lightbulb className="w-3.5 h-3.5" /> Helpful Submission & Filing Tips:
              </span>
              <ul className="space-y-1 pl-4 list-disc text-amber-200/80 text-[11px]">
                {draftResult.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Seamless Transfer & Quick Actions */}
          <div className="pt-2 border-t border-slate-700/60">
            <QuickActionsBar
              documentText={editedContent}
              documentTitle={draftResult.title || 'Drafted Document'}
              onTransferText={onTransferText || (() => {})}
              onSaveHistory={onSaveHistory}
            />
          </div>
        </div>
      )}
    </div>
  );
};
