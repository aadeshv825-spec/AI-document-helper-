export type ActiveTab =
  | 'home'
  | 'photo-to-text'
  | 'pdf-summary'
  | 'ask-document'
  | 'hindi-translation'
  | 'ai-writer'
  | 'scan-clean'
  | 'pdf-tools';

export type QuickActionType =
  | 'summarize'
  | 'translate'
  | 'ask'
  | 'extract-points'
  | 'make-notes'
  | 'find-entities';

export interface QuickActionResult {
  type: QuickActionType;
  title: string;
  data: any;
  timestamp: number;
}

export interface DocumentHistoryItem {
  id: string;
  userId?: string;
  title: string;
  type: ActiveTab;
  snippet: string;
  fullContent: string;
  timestamp: number;
  isFavorite?: boolean;
  category?: string;
}

export type PlanTier = 'free' | 'pro';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  plan: PlanTier;
  proUntil?: number;
  createdAt: number;
  preferredLanguage?: string;
  avatarUrl?: string;
  authProvider?: 'password' | 'google';
  isAdmin?: boolean;
}

export interface AdminUserItem {
  id: string;
  name: string;
  email: string;
  plan: PlanTier;
  createdAt: number;
  authProvider?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  role?: string;
  usage?: UsageStats;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
  usage: UsageStats;
}

export const DOCUMENT_CATEGORIES = [
  'All',
  'General',
  'Invoices & Bills',
  'Contracts & Legal',
  'Letters & Applications',
  'Notes & Summaries',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface UsageStats {
  dailyUsed: number;
  dailyLimit: number;
  dateString: string;
}

export interface PhotoToTextResponse {
  extractedText: string;
  detectedLanguage?: string;
  summary?: string;
  structuredDetails?: { label: string; value: string }[];
}

export interface PdfSummaryResponse {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  importantDatesOrNumbers: string[];
}

export interface AskDocumentResponse {
  answer: string;
  relevantExcerpts: string[];
  suggestedQuestions: string[];
}

export interface TranslationResponse {
  translatedText: string;
  sourceLang: 'Hindi' | 'English' | 'Auto';
  targetLang: 'Hindi' | 'English';
  romanizedPronunciation?: string;
  glossary?: { term: string; explanation: string }[];
}

export interface AiWriterResponse {
  title: string;
  content: string;
  tips: string[];
}
