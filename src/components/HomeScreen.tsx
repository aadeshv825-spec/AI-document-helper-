import React, { useState, useMemo } from 'react';
import {
  Camera,
  FileSearch,
  MessageSquareQuote,
  Languages,
  PenTool,
  ArrowRight,
  Sparkles,
  Zap,
  FileCheck,
  HelpCircle,
  Crown,
  Star,
  Share2,
  Check,
  Infinity as InfinityIcon,
  CheckCircle2,
  Scan,
  Files,
  Search,
  Clock,
  Play,
  Pencil,
  Trash2,
  X,
  FileText,
  FolderOpen,
} from 'lucide-react';
import { ActiveTab, DocumentHistoryItem, PlanTier, UsageStats } from '../types';
import { shareDocumentContent } from '../utils/share';

interface HomeScreenProps {
  onSelectTab: (tab: ActiveTab) => void;
  recentHistory: DocumentHistoryItem[];
  onSelectHistory: (item: DocumentHistoryItem) => void;
  onLoadSample: (sampleId: string) => void;
  onToggleFavorite: (id: string) => void;
  plan: PlanTier;
  usage: UsageStats;
  onOpenPro: () => void;
  onRenameItem?: (id: string, newTitle: string) => void;
  onDeleteItem?: (id: string) => void;
  onChangeCategory?: (id: string, category: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectTab,
  recentHistory,
  onSelectHistory,
  onLoadSample,
  onToggleFavorite,
  plan,
  usage,
  onOpenPro,
  onRenameItem,
  onDeleteItem,
  onChangeCategory,
}) => {
  const [activityTab, setActivityTab] = useState<'all' | 'favorites'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sharedItemId, setSharedItemId] = useState<string | null>(null);

  // Inline rename state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState<string>('');

  const isPro = plan === 'pro';

  // Find most recent item for "Continue where you left off"
  const mostRecentItem = recentHistory.length > 0 ? recentHistory[0] : null;

  const handleShareItem = async (e: React.MouseEvent, item: DocumentHistoryItem) => {
    e.stopPropagation();
    const outcome = await shareDocumentContent({
      title: item.title,
      text: `${item.title}\n\n${item.fullContent}`,
    });
    if (outcome !== 'dismissed') {
      setSharedItemId(item.id);
      setTimeout(() => setSharedItemId(null), 2000);
    }
  };

  const startRename = (e: React.MouseEvent, item: DocumentHistoryItem) => {
    e.stopPropagation();
    setEditingItemId(item.id);
    setEditTitleValue(item.title);
  };

  const saveRename = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (editTitleValue.trim() && onRenameItem) {
      onRenameItem(id, editTitleValue.trim());
    }
    setEditingItemId(null);
  };

  const cancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItemId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (onDeleteItem) {
      onDeleteItem(id);
    }
  };

  // Filtered history list
  const filteredHistory = useMemo(() => {
    let list = recentHistory;
    if (activityTab === 'favorites') {
      list = list.filter((i) => i.isFavorite);
    }
    if (selectedCategory !== 'All') {
      list = list.filter((i) => (i.category || 'General') === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.snippet.toLowerCase().includes(q) ||
          i.fullContent.toLowerCase().includes(q)
      );
    }
    return list;
  }, [recentHistory, activityTab, selectedCategory, searchQuery]);

  const categories = [
    'All',
    'General',
    'Invoices & Bills',
    'Contracts & Legal',
    'Letters & Applications',
    'Notes & Summaries',
  ];

  const tools = [
    {
      id: 'scan-clean' as ActiveTab,
      name: 'Scan & Clean Document',
      tag: 'Straighten & Multi-Page',
      description: 'Auto-crop, straighten skewed camera snaps, clean shadows & export pristine PDF/image.',
      icon: Scan,
      iconColor: 'text-teal-400',
      bgColor: 'bg-teal-500/10 border-teal-500/20 hover:border-teal-500/40',
    },
    {
      id: 'pdf-tools' as ActiveTab,
      name: 'PDF Tools',
      tag: 'Merge, Split, Compress',
      description: 'Combine multiple PDFs, split pages, compress file size, convert images to PDF & extract pages.',
      icon: Files,
      iconColor: 'text-violet-400',
      bgColor: 'bg-violet-500/10 border-violet-500/20 hover:border-violet-500/40',
    },
    {
      id: 'photo-to-text' as ActiveTab,
      name: 'Photo to Text',
      tag: 'OCR Extraction',
      description: 'Snap or upload document photos, receipts, or notes to extract editable text instantly.',
      icon: Camera,
      iconColor: 'text-sky-400',
      bgColor: 'bg-sky-500/10 border-sky-500/20 hover:border-sky-500/40',
    },
    {
      id: 'pdf-summary' as ActiveTab,
      name: 'PDF Summary',
      tag: 'Key Takeaways',
      description: 'Condense lengthy legal contracts, notices, and reports into quick bullet points.',
      icon: FileSearch,
      iconColor: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/40',
    },
    {
      id: 'ask-document' as ActiveTab,
      name: 'Ask Document',
      tag: 'Interactive Q&A',
      description: 'Chat directly with your documents to find clauses, deadlines, fees, and obligations.',
      icon: MessageSquareQuote,
      iconColor: 'text-amber-400',
      bgColor: 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40',
    },
    {
      id: 'hindi-translation' as ActiveTab,
      name: 'Hindi-English Translation',
      tag: 'हिन्दी ⇄ English',
      description: 'Translate official notices and agreements with phonetic pronunciation & vocabulary.',
      icon: Languages,
      iconColor: 'text-indigo-400',
      bgColor: 'bg-indigo-500/10 border-indigo-500/20 hover:border-indigo-500/40',
    },
    {
      id: 'ai-writer' as ActiveTab,
      name: 'AI Writer',
      tag: 'Letters & Notices',
      description: 'Draft formal leave applications, bank letters, rental notices, and complaints.',
      icon: PenTool,
      iconColor: 'text-rose-400',
      bgColor: 'bg-rose-500/10 border-rose-500/20 hover:border-rose-500/40',
    },
  ];

  return (
    <div className="space-y-5 pb-6">
      {/* Welcome Banner & Plan Status Card */}
      <div className="bg-gradient-to-b from-slate-800/90 to-slate-800/50 border border-slate-700/70 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              Smart Document Suite
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-100 leading-snug">
              What do you need help with?
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-lg leading-relaxed">
              Extract text from images, summarize agreements, ask questions, translate Devanagari Hindi, or draft official letters on your mobile device.
            </p>
          </div>

          <button
            onClick={onOpenPro}
            className="hidden sm:flex p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 items-center justify-center transition-colors shrink-0"
            title="Manage Pro Plan"
          >
            <Crown className="w-5 h-5 fill-current" />
          </button>
        </div>

        {/* Free vs Pro Usage Status Pill / Bar */}
        <div
          className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 ${
            isPro
              ? 'bg-amber-950/30 border-amber-500/40'
              : 'bg-slate-900/70 border-slate-700/60'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-lg ${
                isPro ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/15 text-blue-400'
              }`}
            >
              {isPro ? <Crown className="w-4 h-4 fill-current" /> : <Zap className="w-4 h-4" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-200">
                  {isPro ? 'Pro Member' : 'Free Tier Usage'}
                </span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    isPro
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isPro ? 'Unlimited Access' : `${usage.dailyUsed} / ${usage.dailyLimit} scans today`}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isPro
                  ? 'Priority Gemini AI processing & unlimited daily OCR enabled'
                  : usage.dailyUsed >= usage.dailyLimit
                  ? 'Daily free quota reached (5/5). Start 30-day Pro trial for unlimited scans.'
                  : `${usage.dailyLimit - usage.dailyUsed} free operations remaining today`}
              </p>
            </div>
          </div>

          {/* Action button */}
          <div className="w-full sm:w-auto flex items-center justify-end">
            {!isPro ? (
              <button
                id="home-btn-upgrade-pro"
                onClick={onOpenPro}
                className="w-full sm:w-auto py-1.5 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 shadow-sm transition-all active:scale-95"
              >
                <Crown className="w-3.5 h-3.5 fill-current" />
                {usage.dailyUsed >= usage.dailyLimit ? 'Start 30-Day Trial' : 'Upgrade to Pro'}
              </button>
            ) : (
              <button
                onClick={onOpenPro}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Plan Active
              </button>
            )}
          </div>
        </div>

        {/* Highlighted Alert when Free Limit is Reached */}
        {!isPro && usage.dailyUsed >= usage.dailyLimit && (
          <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200 shadow-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Free daily quota reached. Activate your 30-Day Pro Trial to scan without interruption.</span>
            </div>
            <button
              onClick={onOpenPro}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs shrink-0 transition-colors shadow-sm"
            >
              Start Trial
            </button>
          </div>
        )}

        {/* 1-Tap Quick Test Presets */}
        <div className="pt-2 border-t border-slate-700/50 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-400 font-medium shrink-0">Quick Demo:</span>
          <button
            id="quick-demo-rental"
            onClick={() => {
              onLoadSample('rental-lease');
              onSelectTab('pdf-summary');
            }}
            className="text-[11px] px-2.5 py-1 rounded-full bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600/40 transition-colors"
          >
            📄 Rental Agreement
          </button>
          <button
            id="quick-demo-bill"
            onClick={() => {
              onLoadSample('electricity-notice');
              onSelectTab('ask-document');
            }}
            className="text-[11px] px-2.5 py-1 rounded-full bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600/40 transition-colors"
          >
            ⚡ Utility Notice
          </button>
          <button
            id="quick-demo-hindi"
            onClick={() => {
              onLoadSample('hindi-official-notice');
              onSelectTab('hindi-translation');
            }}
            className="text-[11px] px-2.5 py-1 rounded-full bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600/40 transition-colors"
          >
            🇮🇳 सरकारी परिपत्र
          </button>
        </div>
      </div>

      {/* Continue where you left off Section */}
      {mostRecentItem && (
        <div className="bg-gradient-to-r from-blue-950/40 via-slate-850 to-slate-900 border border-blue-500/30 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-400">
              <Clock className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-300">
                Continue Where You Left Off
              </h3>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {new Date(mostRecentItem.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          <div
            onClick={() => onSelectHistory(mostRecentItem)}
            className="p-3 bg-slate-900/80 hover:bg-slate-900 border border-slate-750 hover:border-blue-500/50 rounded-xl cursor-pointer transition-all space-y-2 group"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="text-sm font-semibold text-slate-100 group-hover:text-blue-300 transition-colors truncate">
                  {mostRecentItem.title}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60 font-mono shrink-0">
                  {mostRecentItem.type}
                </span>
              </div>

              <button
                id="btn-resume-recent"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectHistory(mostRecentItem);
                }}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-lg flex items-center gap-1 shrink-0 transition-colors shadow-xs"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Resume</span>
              </button>
            </div>

            <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
              {mostRecentItem.snippet}
            </p>

            {/* Quick Next Actions for this recent document */}
            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <span className="text-[10px] text-slate-400 font-medium">Quick Actions:</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectHistory(mostRecentItem);
                  onSelectTab('pdf-summary');
                }}
                className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors"
              >
                Summarize
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectHistory(mostRecentItem);
                  onSelectTab('ask-document');
                }}
                className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors"
              >
                Ask Q&A
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectHistory(mostRecentItem);
                  onSelectTab('hindi-translation');
                }}
                className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors"
              >
                Translate Hindi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Functional Tools Grid */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">
          Document Tools
        </h3>
        <div className="grid grid-cols-1 gap-2.5">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                id={`home-tool-${tool.id}`}
                onClick={() => onSelectTab(tool.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all duration-150 active:scale-[0.99] flex items-center justify-between gap-3 group ${tool.bgColor}`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 ${tool.iconColor} shrink-0 mt-0.5`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-100 group-hover:text-white truncate">
                        {tool.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 font-medium shrink-0">
                        {tool.tag}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                </div>
                <div className="p-1 text-slate-500 group-hover:text-slate-300 transition-colors shrink-0">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pro Benefits Section */}
      <div className="bg-gradient-to-r from-amber-500/10 via-slate-800/60 to-blue-500/10 border border-amber-500/30 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-400 fill-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Pro Benefits & Capabilities
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 font-medium">
            ₹58/mo on annual (₹699/yr)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300">
          <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl flex items-start gap-2">
            <InfinityIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-200 block">Unlimited Operations</span>
              <span className="text-[11px] text-slate-400">Zero scan ceilings or cooldown pauses.</span>
            </div>
          </div>
          <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl flex items-start gap-2">
            <Zap className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-200 block">Priority Gemini AI</span>
              <span className="text-[11px] text-slate-400">Ultra-low latency inference with resilient fallback.</span>
            </div>
          </div>
          <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl flex items-start gap-2">
            <Files className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-200 block">Batch Processing</span>
              <span className="text-[11px] text-slate-400">Batch merge up to 20 PDFs & multi-photo OCR.</span>
            </div>
          </div>
          <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl flex items-start gap-2">
            <Star className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 fill-amber-400" />
            <div>
              <span className="font-semibold text-slate-200 block">Cloud Document Vault</span>
              <span className="text-[11px] text-slate-400">Cross-device sync, custom folders & search.</span>
            </div>
          </div>
        </div>

        <button
          id="btn-explore-pro-benefits"
          onClick={onOpenPro}
          className="w-full py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700/80 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
        >
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          {isPro ? 'View Pro Membership Details' : 'Explore Pro & Start 30-Day Free Trial'}
        </button>
      </div>

      {/* Recent Activity & Favorites Vault Section with Search & Categories */}
      <div className="space-y-3 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Saved Documents & Activity ({filteredHistory.length})
          </h3>

          <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60 self-start sm:self-auto">
            <button
              onClick={() => setActivityTab('all')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                activityTab === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({recentHistory.length})
            </button>
            <button
              onClick={() => setActivityTab('favorites')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                activityTab === 'favorites'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star className="w-3 h-3 fill-current" />
              Starred ({recentHistory.filter((i) => i.isFavorite).length})
            </button>
          </div>
        </div>

        {/* Live Search & Category Filter */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents by title or keywords..."
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-slate-700 text-white border border-slate-600 shadow-xs'
                    : 'bg-slate-850/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="p-8 bg-slate-800/30 border border-slate-800 rounded-xl text-center text-xs text-slate-400 space-y-2">
            <FolderOpen className="w-8 h-8 mx-auto opacity-30 text-slate-400" />
            <p>
              {searchQuery
                ? `No documents matching "${searchQuery}".`
                : activityTab === 'favorites'
                ? 'No starred documents yet. Tap the star on any document to save it here.'
                : 'No documents in this category yet. Start scanning or summarizing above.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredHistory.map((item) => {
              const isFav = !!item.isFavorite;
              const isJustShared = sharedItemId === item.id;
              const isEditing = editingItemId === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => onSelectHistory(item)}
                  className="p-3 bg-slate-850/70 hover:bg-slate-800 border border-slate-800/80 rounded-xl cursor-pointer transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileCheck className="w-4 h-4 text-blue-400 shrink-0" />
                      {isEditing ? (
                        <div
                          className="flex items-center gap-1.5 flex-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editTitleValue}
                            onChange={(e) => setEditTitleValue(e.target.value)}
                            className="bg-slate-900 border border-blue-500 rounded px-2 py-0.5 text-xs text-slate-100 flex-1 focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={(e) => saveRename(e, item.id)}
                            className="p-1 text-emerald-400 hover:text-emerald-300"
                            title="Save title"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={cancelRename}
                            className="p-1 text-slate-400 hover:text-slate-200"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-slate-200 truncate">
                          {item.title}
                        </span>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Inline rename button */}
                        <button
                          onClick={(e) => startRename(e, item)}
                          className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-750 transition-colors"
                          title="Rename document"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>

                        {/* Favorite button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(item.id);
                          }}
                          className={`p-1 rounded-md hover:bg-slate-750 transition-colors ${
                            isFav ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
                          }`}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                        </button>

                        {/* Web Share button */}
                        <button
                          onClick={(e) => handleShareItem(e, item)}
                          className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-750 transition-colors"
                          title="Share document"
                        >
                          {isJustShared ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Share2 className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Delete button */}
                        <button
                          onClick={(e) => handleDelete(e, item.id)}
                          className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-slate-750 transition-colors"
                          title="Delete from history"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {item.snippet}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 font-mono text-slate-400 border border-slate-800">
                        {item.type}
                      </span>
                      {item.category && item.category !== 'General' && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-300 border border-blue-900/40">
                          {item.category}
                        </span>
                      )}
                    </div>
                    <span>
                      {new Date(item.timestamp).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      at{' '}
                      {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile Tips Footer */}
      <div className="p-3.5 bg-slate-800/20 border border-slate-800/60 rounded-xl flex items-start gap-2.5 text-slate-400 text-xs">
        <HelpCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed text-[11px] text-slate-400">
          <strong className="text-slate-300">Tip:</strong> You can edit document titles and organize them into categories anytime. All saved documents stay synced across your devices when signed in.
        </p>
      </div>
    </div>
  );
};
