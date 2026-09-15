import React, { useState, useMemo } from 'react';
import {
  X,
  Trash2,
  Clock,
  ArrowUpRight,
  Copy,
  Check,
  Star,
  Share2,
  Search,
  Folder,
  Edit2,
  Download,
  CloudCheck,
  Tag,
  CheckCircle,
} from 'lucide-react';
import { DocumentHistoryItem, DOCUMENT_CATEGORIES } from '../types';
import { shareDocumentContent } from '../utils/share';
import { useAuth } from '../context/AuthContext';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: DocumentHistoryItem[];
  onSelect: (item: DocumentHistoryItem) => void;
  onClear: () => void;
  onToggleFavorite?: (id: string) => void;
  onRenameItem?: (id: string, newTitle: string) => void;
  onChangeCategory?: (id: string, category: string) => void;
  onDeleteItem?: (id: string) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  history,
  onSelect,
  onClear,
  onToggleFavorite,
  onRenameItem,
  onChangeCategory,
  onDeleteItem,
}) => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);

  // Inline rename state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editTitleVal, setEditTitleVal] = useState('');

  // Move category state
  const [categoryMenuId, setCategoryMenuId] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredHistory = history.filter((item) => {
    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title?.toLowerCase().includes(q);
      const matchSnippet = item.snippet?.toLowerCase().includes(q);
      const matchContent = item.fullContent?.toLowerCase().includes(q);
      if (!matchTitle && !matchSnippet && !matchContent) return false;
    }

    // Category / folder filter
    if (selectedCategory === 'Favorites') {
      return Boolean(item.isFavorite);
    }
    if (selectedCategory !== 'All') {
      return (item.category || 'General') === selectedCategory;
    }
    return true;
  });

  const handleCopy = async (e: React.MouseEvent, item: DocumentHistoryItem) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.fullContent);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleShare = async (e: React.MouseEvent, item: DocumentHistoryItem) => {
    e.stopPropagation();
    const outcome = await shareDocumentContent({
      title: item.title,
      text: `${item.title}\n\n${item.fullContent}`,
    });
    if (outcome !== 'dismissed') {
      setSharedId(item.id);
      setTimeout(() => setSharedId(null), 2000);
    }
  };

  const handleDownload = (e: React.MouseEvent, item: DocumentHistoryItem) => {
    e.stopPropagation();
    const blob = new Blob([item.fullContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'document'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadedId(item.id);
    setTimeout(() => setDownloadedId(null), 2000);
  };

  const startRename = (e: React.MouseEvent, item: DocumentHistoryItem) => {
    e.stopPropagation();
    setEditingItemId(item.id);
    setEditTitleVal(item.title);
  };

  const saveRename = (e: React.MouseEvent | React.FormEvent, itemId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (editTitleVal.trim() && onRenameItem) {
      onRenameItem(itemId, editTitleVal.trim());
    }
    setEditingItemId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Saved Documents & History
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sync Status Banner */}
        <div className="px-4 py-2 bg-slate-800/40 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${user ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {user ? (
              <span className="text-slate-300 font-medium">Synced with {user.email}</span>
            ) : (
              <span>Saved locally (sign in to sync across devices)</span>
            )}
          </span>
          <span className="font-mono text-slate-400">{history.length} items</span>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/60 shrink-0 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, keywords or content..."
              className="w-full bg-slate-800/90 border border-slate-700/80 rounded-xl pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category / Folder Horizontal Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
            <button
              onClick={() => setSelectedCategory('All')}
              className={`px-2.5 py-1 rounded-lg shrink-0 font-medium transition-colors ${
                selectedCategory === 'All'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({history.length})
            </button>
            <button
              onClick={() => setSelectedCategory('Favorites')}
              className={`px-2.5 py-1 rounded-lg shrink-0 font-medium flex items-center gap-1 transition-colors ${
                selectedCategory === 'Favorites'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star className="w-3 h-3 fill-current" />
              Starred ({history.filter((h) => h.isFavorite).length})
            </button>
            {DOCUMENT_CATEGORIES.filter((c) => c !== 'All').map((cat) => {
              const count = history.filter((h) => (h.category || 'General') === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg shrink-0 font-medium transition-colors ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat} {count > 0 && `(${count})`}
                </button>
              );
            })}
          </div>
        </div>

        {/* History Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredHistory.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-xs space-y-2">
              <Clock className="w-8 h-8 mx-auto opacity-30" />
              <p className="font-medium text-slate-400">No documents found</p>
              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                {searchQuery
                  ? `No saved documents match "${searchQuery}". Try different keywords.`
                  : selectedCategory === 'Favorites'
                  ? 'No starred documents yet. Tap the star icon on any document to save it here.'
                  : 'Documents you transcribe, summarize, or translate will appear here automatically.'}
              </p>
            </div>
          ) : (
            filteredHistory.map((item) => {
              const isFav = !!item.isFavorite;
              const isCopied = copiedId === item.id;
              const isShared = sharedId === item.id;
              const isDownloaded = downloadedId === item.id;
              const isEditing = editingItemId === item.id;
              const isCategoryOpen = categoryMenuId === item.id;

              return (
                <div
                  key={item.id}
                  className="p-3 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl transition-all space-y-2.5 shadow-sm"
                >
                  {/* Item Header / Rename */}
                  <div className="flex items-start justify-between gap-2">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => saveRename(e, item.id)}
                        className="flex items-center gap-1.5 flex-1"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editTitleVal}
                          onChange={(e) => setEditTitleVal(e.target.value)}
                          className="w-full bg-slate-900 border border-blue-500 rounded px-2 py-0.5 text-xs text-slate-100"
                        />
                        <button
                          type="submit"
                          className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-medium shrink-0"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(null)}
                          className="px-1.5 py-0.5 text-slate-400 hover:text-slate-200 text-[11px]"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-xs font-semibold text-slate-100 truncate">
                          {item.title}
                        </span>
                        {onRenameItem && (
                          <button
                            onClick={(e) => startRename(e, item)}
                            className="p-0.5 text-slate-500 hover:text-slate-300 rounded opacity-70 hover:opacity-100 shrink-0"
                            title="Rename document"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Action Buttons: Star, Share, Copy, Download, Delete */}
                    <div className="flex items-center gap-1 shrink-0">
                      {onToggleFavorite && (
                        <button
                          onClick={() => onToggleFavorite(item.id)}
                          className={`p-1 rounded-md hover:bg-slate-700 transition-colors ${
                            isFav ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
                          }`}
                          title={isFav ? 'Unstar' : 'Star document'}
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
                        </button>
                      )}

                      <button
                        onClick={(e) => handleShare(e, item)}
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
                        title="Share document"
                      >
                        {isShared ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={(e) => handleCopy(e, item)}
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
                        title="Copy text"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={(e) => handleDownload(e, item)}
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
                        title="Download .txt"
                      >
                        {isDownloaded ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
                      </button>

                      {onDeleteItem && (
                        <button
                          onClick={() => onDeleteItem(item.id)}
                          className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded-md transition-colors"
                          title="Delete item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Snippet */}
                  <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed font-normal">
                    {item.snippet}
                  </p>

                  {/* Category Tag & Open Link */}
                  <div className="pt-1.5 flex items-center justify-between border-t border-slate-700/50 text-[10px]">
                    <div className="relative flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 font-mono">
                        {item.type}
                      </span>

                      {/* Folder / Category Pill with picker */}
                      {onChangeCategory && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setCategoryMenuId(isCategoryOpen ? null : item.id)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-700/80 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                            title="Change folder/category"
                          >
                            <Folder className="w-2.5 h-2.5 text-indigo-400" />
                            <span>{item.category || 'General'}</span>
                          </button>

                          {isCategoryOpen && (
                            <div className="absolute left-0 bottom-full mb-1 w-44 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-20 p-1 space-y-0.5">
                              <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                Select Folder
                              </p>
                              {DOCUMENT_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                                <button
                                  key={cat}
                                  onClick={() => {
                                    onChangeCategory(item.id, cat);
                                    setCategoryMenuId(null);
                                  }}
                                  className={`w-full text-left px-2 py-1 rounded-lg text-[11px] transition-colors ${
                                    (item.category || 'General') === cat
                                      ? 'bg-blue-600 text-white font-medium'
                                      : 'text-slate-300 hover:bg-slate-800'
                                  }`}
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        onSelect(item);
                        onClose();
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-0.5"
                    >
                      Open in Tool <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer */}
        {history.length > 0 && (
          <div className="p-3.5 border-t border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
            <span className="text-[11px] text-slate-500">
              Showing {filteredHistory.length} of {history.length} documents
            </span>
            <button
              onClick={onClear}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear All
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
