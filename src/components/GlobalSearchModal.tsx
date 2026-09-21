import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  X,
  FileText,
  Sparkles,
  ArrowRight,
  Clock,
  ExternalLink,
  Layers,
  FileSearch,
  Camera,
  Languages,
  PenTool,
  BookOpen,
} from 'lucide-react';
import { ActiveTab, DocumentHistoryItem } from '../types';
import { SAMPLE_DOCUMENTS, SampleDoc } from '../data/sampleDocuments';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  history: DocumentHistoryItem[];
  onSelectHistory: (item: DocumentHistoryItem) => void;
  onLoadSample: (sampleId: string) => void;
}

interface AppToolItem {
  id: ActiveTab;
  name: string;
  category: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
}

const APP_TOOLS: AppToolItem[] = [
  {
    id: 'scan-clean',
    name: 'Scan & Clean Doc',
    category: 'Core Tools',
    description: 'Straighten, perspective crop & enhance readability of papers, IDs and receipts',
    icon: Layers,
    keywords: ['scan', 'scanner', 'clean', 'crop', 'enhance', 'contrast', 'straighten', 'paper', 'id card'],
  },
  {
    id: 'pdf-tools',
    name: 'PDF Tools',
    category: 'Core Tools',
    description: 'Merge multiple PDFs, split pages, compress file size, and convert images to PDF',
    icon: FileText,
    keywords: ['pdf', 'merge', 'split', 'compress', 'convert', 'combine', 'extract pages'],
  },
  {
    id: 'photo-to-text',
    name: 'Photo to Text (OCR)',
    category: 'AI Tools',
    description: 'Capture photo or upload document image to extract clean editable text with OCR',
    icon: Camera,
    keywords: ['photo', 'text', 'ocr', 'camera', 'image', 'extract', 'read text', 'transcribe'],
  },
  {
    id: 'pdf-summary',
    name: 'PDF & Doc Summary',
    category: 'AI Tools',
    description: 'Generate concise executive summaries, bullet takeaways & action items from files',
    icon: FileSearch,
    keywords: ['summary', 'summarize', 'bullet points', 'action items', 'executive summary', 'digest'],
  },
  {
    id: 'ask-document',
    name: 'Ask Document (Q&A)',
    category: 'AI Tools',
    description: 'Interactive natural language Q&A: cite clauses, check dates, and inspect conditions',
    icon: BookOpen,
    keywords: ['ask', 'question', 'answers', 'q&a', 'query', 'chat', 'clauses', 'verify'],
  },
  {
    id: 'hindi-translation',
    name: 'Hindi ⇄ English Translation',
    category: 'AI Tools',
    description: 'Accurate bilingual translation preserving legal and bureaucratic terminology',
    icon: Languages,
    keywords: ['hindi', 'english', 'translation', 'translate', 'anuvad', 'bilingual', 'shabd'],
  },
  {
    id: 'ai-writer',
    name: 'AI Writer',
    category: 'AI Tools',
    description: 'Draft professional letters, official appeals, legal notices, and formal complaints',
    icon: PenTool,
    keywords: ['writer', 'draft', 'letter', 'notice', 'complaint', 'application', 'formal email'],
  },
];

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  history,
  onSelectHistory,
  onLoadSample,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const cleanQuery = query.trim().toLowerCase();

  // Search results calculation
  const matchedTools = useMemo(() => {
    if (!cleanQuery) return APP_TOOLS;
    return APP_TOOLS.filter((tool) => {
      const nameMatch = tool.name.toLowerCase().includes(cleanQuery);
      const descMatch = tool.description.toLowerCase().includes(cleanQuery);
      const keywordMatch = tool.keywords.some((k) => k.toLowerCase().includes(cleanQuery));
      return nameMatch || descMatch || keywordMatch;
    });
  }, [cleanQuery]);

  const matchedHistory = useMemo(() => {
    if (!cleanQuery) return history.slice(0, 5);
    return history.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(cleanQuery);
      const contentMatch = (item.fullContent || '').toLowerCase().includes(cleanQuery);
      const toolMatch = item.tool.toLowerCase().includes(cleanQuery);
      const catMatch = (item.category || '').toLowerCase().includes(cleanQuery);
      return titleMatch || contentMatch || toolMatch || catMatch;
    });
  }, [cleanQuery, history]);

  const matchedSamples = useMemo(() => {
    if (!cleanQuery) return SAMPLE_DOCUMENTS.slice(0, 3);
    return SAMPLE_DOCUMENTS.filter((sample) => {
      const titleMatch = sample.title.toLowerCase().includes(cleanQuery);
      const catMatch = sample.category.toLowerCase().includes(cleanQuery);
      const previewMatch = sample.preview.toLowerCase().includes(cleanQuery);
      const textMatch = sample.text.toLowerCase().includes(cleanQuery);
      return titleMatch || catMatch || previewMatch || textMatch;
    });
  }, [cleanQuery]);

  const totalResults = matchedTools.length + matchedHistory.length + matchedSamples.length;

  if (!isOpen) return null;

  return (
    <div
      id="global-search-modal"
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 pt-12 sm:pt-20 bg-black/75 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <Search className="w-5 h-5 text-blue-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents, tools, actions, samples..."
            className="flex-1 bg-transparent text-slate-100 placeholder:text-slate-400 text-sm sm:text-base outline-none focus:ring-0 border-none"
            aria-label="Global search query"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-md hover:bg-slate-800"
              aria-label="Clear search query"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-800 border border-slate-700 rounded">
              ESC
            </kbd>
          )}
        </div>

        {/* Scrollable Results */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs sm:text-sm">
          {totalResults === 0 && (
            <div className="py-12 text-center text-slate-400">
              <Search className="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-60" />
              <p className="font-medium text-slate-300">No matching results found</p>
              <p className="text-xs mt-1 text-slate-500">
                Try searching for keywords like "OCR", "PDF", "Lease", or "Summary"
              </p>
            </div>
          )}

          {/* Tools & Features Section */}
          {matchedTools.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold text-blue-400 uppercase tracking-wider flex items-center justify-between">
                <span>Tools & Features</span>
                <span className="text-slate-500 font-normal">{matchedTools.length} found</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {matchedTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      onClick={() => {
                        onSelectTab(tool.id);
                        onClose();
                      }}
                      className="w-full flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-800/40 hover:bg-blue-600/15 border border-slate-800 hover:border-blue-500/40 text-left transition-all group"
                    >
                      <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200 group-hover:text-blue-300 truncate text-xs sm:text-sm flex items-center justify-between">
                          <span>{tool.name}</span>
                          <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all opacity-0 group-hover:opacity-100" />
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                          {tool.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* User's Saved Documents Section */}
          {matchedHistory.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                <span>Saved Documents ({matchedHistory.length})</span>
                <span className="text-slate-500 font-normal">Recent</span>
              </div>
              <div className="space-y-1.5">
                {matchedHistory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectHistory(item);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-left transition-all group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-200 group-hover:text-emerald-300 text-xs sm:text-sm truncate">
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span className="capitalize">{item.tool.replace('-', ' ')}</span>
                          {item.category && <span>• {item.category}</span>}
                          <span>• {new Date(item.timestamp).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sample Templates Section */}
          {matchedSamples.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center justify-between">
                <span>Sample Document Templates</span>
                <span className="text-slate-500 font-normal">Pre-loaded</span>
              </div>
              <div className="space-y-1.5">
                {matchedSamples.map((sample) => (
                  <button
                    key={sample.id}
                    onClick={() => {
                      onLoadSample(sample.id);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 text-left transition-all group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 rounded-lg bg-amber-600/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-200 group-hover:text-amber-300 text-xs sm:text-sm truncate">
                          {sample.title}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {sample.category} • {sample.preview}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] text-amber-400/90 font-medium px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 shrink-0">
                      Try Sample
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/60 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Global Search: All tools, documents & samples</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xs py-0.5 px-2 rounded hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
