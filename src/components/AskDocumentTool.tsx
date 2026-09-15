import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquareQuote,
  Send,
  Sparkles,
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Volume2,
  VolumeX,
  AlertCircle,
  HelpCircle,
  Quote,
  Copy,
  Check,
  Share2,
  Star,
  Download,
} from 'lucide-react';
import { AskDocumentResponse, ActiveTab } from '../types';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';
import { speakText, stopSpeaking } from '../utils/speech';
import { shareDocumentContent } from '../utils/share';
import { downloadTextFile } from '../utils/download';
import { apiFetch } from '../utils/apiClient';
import { QuickActionsBar } from './QuickActionsBar';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations?: string[];
  suggestedQuestions?: string[];
  timestamp: number;
}

interface AskDocumentProps {
  initialDocumentText?: string;
  onTransferText?: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

export const AskDocumentTool: React.FC<AskDocumentProps> = ({
  initialDocumentText = '',
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [docContext, setDocContext] = useState<string>(
    initialDocumentText && !initialDocumentText.startsWith('data:image/')
      ? initialDocumentText
      : SAMPLE_DOCUMENTS[0].text
  );
  const [isDocFolded, setIsDocFolded] = useState<boolean>(true);
  const [question, setQuestion] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSpeakingId, setIsSpeakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [favoritedIds, setFavoritedIds] = useState<Record<string, boolean>>({});

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am ready to answer any questions about your document. What would you like to know?',
      suggestedQuestions: [
        'What are the key obligations in this document?',
        'Are there any monetary fees or penalties?',
        'What is the effective date and duration?'
      ],
      timestamp: Date.now(),
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialDocumentText && !initialDocumentText.startsWith('data:image/')) {
      setDocContext(initialDocumentText);
    }
  }, [initialDocumentText]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleAsk = async (userQuestion: string) => {
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    const q = userQuestion.trim();
    if (!q) return;

    if (!docContext.trim()) {
      setError('Please provide document text to ask questions about.');
      return;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: q,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/ask-document', {
        method: 'POST',
        body: JSON.stringify({
          documentContext: docContext,
          question: q,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned ${res.status}`);
      }

      const data: AskDocumentResponse = await res.json();

      const aiMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: data.answer,
        citations: data.relevantExcerpts,
        suggestedQuestions: data.suggestedQuestions,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, aiMsg]);

      onSaveHistory(
        `Q: ${q.slice(0, 30)}`,
        'ask-document',
        `Question: ${q}\n\nAnswer: ${data.answer}`
      );
    } catch (err: any) {
      setError(err.message || 'Failed to get answer');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleSpeak = async (msgId: string, text: string) => {
    if (isSpeakingId === msgId) {
      stopSpeaking();
      setIsSpeakingId(null);
    } else {
      setIsSpeakingId(msgId);
      await speakText(text, 'en-US');
      setIsSpeakingId(null);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShareMessage = async (id: string, text: string) => {
    const outcome = await shareDocumentContent({
      title: 'Document Q&A Answer',
      text,
    });
    if (outcome !== 'dismissed') {
      setSharedId(id);
      setTimeout(() => setSharedId(null), 2000);
    }
  };

  const handleDownloadMessage = (text: string) => {
    downloadTextFile(
      text,
      `QA_Answer_${Date.now()}.txt`,
      'text/plain;charset=utf-8'
    );
  };

  return (
    <div className="space-y-3 pb-8">
      {/* Daily Free Limit Alert Banner */}
      {isLimitReached && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200 shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Daily free limit reached (5/5). Start 30-day Pro trial for unlimited questions.</span>
          </div>
          <button
            onClick={onOpenPro}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs shrink-0 transition-colors shadow-sm"
          >
            Start Trial
          </button>
        </div>
      )}

      {/* Document Context Drawer */}
      <div className="bg-slate-850 bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-200 truncate">
              Active Document Context
            </span>
            <span className="text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
              {docContext ? `${docContext.split(/\s+/).length} words` : 'Empty'}
            </span>
          </div>

          <button
            onClick={() => setIsDocFolded(!isDocFolded)}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 p-1"
          >
            <span>{isDocFolded ? 'Edit' : 'Hide'}</span>
            {isDocFolded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Quick Sample Selector */}
        {isDocFolded && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-1 mt-1 text-[11px] no-scrollbar">
            <span className="text-slate-500 text-[10px] shrink-0">Switch doc:</span>
            {SAMPLE_DOCUMENTS.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setDocContext(doc.text)}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-800 text-[10px] shrink-0 transition-colors"
              >
                {doc.title.slice(0, 16)}...
              </button>
            ))}
          </div>
        )}

        {!isDocFolded && (
          <div className="mt-2.5 space-y-2">
            <textarea
              value={docContext}
              onChange={(e) => setDocContext(e.target.value)}
              rows={4}
              placeholder="Paste or update document text to query..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-sans leading-relaxed resize-none"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>You can ask questions once text is loaded</span>
              <button
                onClick={() => setIsDocFolded(true)}
                className="px-2.5 py-1 bg-slate-700 text-slate-200 rounded font-medium text-[11px]"
              >
                Done Editing
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error notification */}
      {error && (
        <div className="p-2.5 bg-rose-950/50 border border-rose-800/60 rounded-xl flex items-center gap-2 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Chat Messages Log */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-3 min-h-[300px] max-h-[460px] overflow-y-auto space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-slate-800 text-slate-200 border border-slate-700/70 rounded-bl-none shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1 text-[10px] opacity-75">
                <span>{msg.sender === 'user' ? 'You' : 'AI Assistant'}</span>
                {msg.sender === 'assistant' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleToggleSpeak(msg.id, msg.text)}
                      className="hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-200"
                      title="Speak text"
                    >
                      {isSpeakingId === msg.id ? (
                        <VolumeX className="w-3 h-3 text-amber-400" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.text)}
                      className="hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-200"
                      title="Copy answer"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => handleShareMessage(msg.id, msg.text)}
                      className="hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-200"
                      title="Share answer via Web Share"
                    >
                      {sharedId === msg.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Share2 className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDownloadMessage(msg.text)}
                      className="hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-200"
                      title="Download answer as text file"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        const isFav = !favoritedIds[msg.id];
                        setFavoritedIds((prev) => ({ ...prev, [msg.id]: isFav }));
                        onSaveHistory(
                          `Q&A: ${msg.text.slice(0, 30)}`,
                          'ask-document',
                          msg.text,
                          isFav
                        );
                      }}
                      className={`hover:opacity-100 p-0.5 rounded transition-colors ${
                        favoritedIds[msg.id]
                          ? 'text-amber-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title={favoritedIds[msg.id] ? 'Saved to Favorites' : 'Save to Favorites'}
                    >
                      <Star
                        className={`w-3 h-3 ${favoritedIds[msg.id] ? 'fill-current' : ''}`}
                      />
                    </button>
                  </div>
                )}
              </div>

              <p className="whitespace-pre-wrap">{msg.text}</p>

              {/* Citations/Excerpts from document */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-700/60 space-y-1">
                  <span className="text-[10px] font-semibold text-amber-300 flex items-center gap-1">
                    <Quote className="w-2.5 h-2.5" /> Cited from document:
                  </span>
                  {msg.citations.map((c, i) => (
                    <blockquote
                      key={i}
                      className="text-[11px] text-slate-300 italic bg-slate-900/60 p-1.5 rounded border-l-2 border-amber-500"
                    >
                      {c}
                    </blockquote>
                  ))}
                </div>
              )}
            </div>

            {/* Suggested Follow-up chips for assistant messages */}
            {msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1 max-w-[90%]">
                {msg.suggestedQuestions.map((q, qIdx) => (
                  <button
                    key={qIdx}
                    onClick={() => handleAsk(q)}
                    className="text-[10px] px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors text-left"
                  >
                    💬 {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-xs p-2 bg-slate-800/40 rounded-xl max-w-[180px]">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
            <span>Analyzing document...</span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Box Bar */}
      <div className="flex items-center gap-2 pt-1">
        <input
          id="ask-doc-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAsk(question);
          }}
          placeholder="Ask a question about this document..."
          className="flex-1 bg-slate-800/90 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
        />
        <button
          id="btn-send-question"
          onClick={() => handleAsk(question)}
          disabled={isLoading || !question.trim()}
          className="p-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-600 rounded-xl font-medium transition-colors shadow-sm shrink-0"
          aria-label="Send question"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions Bar for the Document */}
      {docContext.trim() && (
        <div className="pt-2 border-t border-slate-800">
          <QuickActionsBar
            documentText={docContext}
            documentTitle="Current Document Q&A"
            onTransferText={onTransferText || (() => {})}
            onSaveHistory={onSaveHistory}
            showFullActions={false}
          />
        </div>
      )}
    </div>
  );
};
