import express from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';
import { createServer as createViteServer } from 'vite';
import {
  registerUser,
  authenticateUser,
  findOrCreateGoogleUser,
  getUserByToken,
  updateUserProfile,
  updateUserPlan,
  deleteUserAccount,
  getUserDocuments,
  saveUserDocument,
  updateUserDocument,
  deleteUserDocument,
  clearUserDocuments,
  syncUserDocuments,
  checkRateLimit,
  getDailyUsage,
  canPerformAiAction,
  incrementDailyUsage,
  invalidateSession,
  getAllUsers,
  isUserAdmin,
  OWNER_EMAIL,
  StoredUser,
  GOOGLE_PLAY_SKUS,
  isValidGooglePlaySku,
  findGooglePlayPurchaseByToken,
  recordGooglePlayPurchase,
  getUserGooglePlayPurchases,
  GooglePlayPurchaseRecord,
  initStore,
  flushStore,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  findUserByEmail,
  setUserPassword,
  verifyUserPassword,
  createSession,
} from './server/store.ts';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Cloud Run sits behind exactly one Google front-end proxy.
// This makes req.ip the real client IP instead of a spoofable
// X-Forwarded-For value supplied by the client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (IS_PRODUCTION) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

// Allowed cross-origin callers: Android WebView asset origin,
// optional extra origins from ALLOWED_ORIGINS (comma-separated),
// and localhost only outside production.
const ALLOWED_CORS_ORIGINS = new Set<string>([
  'https://appassets.androidplatform.net',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  ...(IS_PRODUCTION
    ? []
    : ['http://localhost:3000', 'http://localhost:5173']),
]);

// CORS support for Android WebView / appassets origin
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (
    origin &&
    ALLOWED_CORS_ORIGINS.has(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-client-id'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

function getClientIp(req: express.Request): string {
  return (
    req.ip ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// Stricter limits for credential and purchase endpoints
// (brute-force / credential-stuffing protection).
const SENSITIVE_RATE_LIMITS: Array<{
  prefix: string;
  limit: number;
}> = [
  { prefix: '/api/auth/login', limit: 20 },
  { prefix: '/api/auth/register', limit: 10 },
  { prefix: '/api/auth/password-reset', limit: 5 },
  { prefix: '/api/auth/change-password', limit: 10 },
  { prefix: '/api/auth/google', limit: 30 },
  { prefix: '/api/billing/google-play/verify-purchase', limit: 20 },
  { prefix: '/api/billing/google-play/restore-purchases', limit: 20 },
];

app.use('/api/', (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];

  const rule = SENSITIVE_RATE_LIMITS.find((r) =>
    fullPath.startsWith(r.prefix)
  );

  if (!rule || req.method === 'OPTIONS') {
    return next();
  }

  const { allowed, retryAfter } = checkRateLimit(
    `${rule.prefix}:${getClientIp(req)}`,
    rule.limit
  );

  if (!allowed) {
    return res.status(429).json({
      error: 'Too many attempts. Please wait a moment before trying again.',
      retryAfter,
    });
  }

  next();
});

// Global API rate limiting middleware for abuse prevention
app.use('/api/', (req, res, next) => {
  const ip = getClientIp(req);

  const { allowed, retryAfter } = checkRateLimit(ip, 120);

  if (!allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please wait a moment before trying again.',
      retryAfter,
    });
  }

  next();
});

// Helper for extracting authenticated user & rate limiting identifier
function isProActive(
  user: Pick<StoredUser, 'id' | 'plan' | 'proUntil'> | null
): boolean {
  if (!user || user.plan !== 'pro') return false;

  // Legacy Pro accounts without an expiry remain active.
  if (user.proUntil == null) return true;

  const expiryTime = user.proUntil;

  if (
    Number.isFinite(expiryTime) &&
    expiryTime > Date.now()
  ) {
    return true;
  }

  // Downgrade expired Pro accounts and persist the change.
  try {
    updateUserPlan(user.id, 'free');
  } catch (error) {
    console.error(
      '[ProExpiry] Failed to persist expired Pro downgrade:',
      error
    );
  }

  user.plan = 'free';
  user.proUntil = undefined;

  return false;
}

// Session tokens are accepted only from the Authorization header.
function getTokenFromRequest(
  req: express.Request
): string | null {
  const authHeader = req.headers.authorization;

  if (
    typeof authHeader !== 'string' ||
    !authHeader.startsWith('Bearer ')
  ) {
    return null;
  }

  const token = authHeader.slice(7).trim();

  if (!token || token.length > 256) {
    return null;
  }

  return token;
}

// Usage for a signed-in user is tracked under the same identifier
// that the AI endpoints increment (see getAuthContext).
function getUserUsage(
  user: Pick<StoredUser, 'id' | 'plan' | 'proUntil'>
) {
  return getDailyUsage(
    `user:${user.id}`,
    isProActive(user)
  );
}

function getAuthContext(req: express.Request): {
  user: StoredUser | null;
  identifier: string;
  isPro: boolean;
} {
  const token = getTokenFromRequest(req);
  const user = token ? getUserByToken(token) : null;

  const identifier = user
    ? `user:${user.id}`
    : `ip:${getClientIp(req)}`;

  const isPro = isProActive(user);

  return {
    user,
    identifier,
    isPro,
  };
}

// Server-side AI usage check middleware helper
function checkAiUsage(
  req: express.Request,
  res: express.Response
): {
  user: StoredUser | null;
  identifier: string;
  isPro: boolean;
} | null {
  const authCtx = getAuthContext(req);

  if (!canPerformAiAction(authCtx.identifier, authCtx.isPro)) {
    const currentUsage = getDailyUsage(
      authCtx.identifier,
      authCtx.isPro
    );

    res.status(429).json({
      error:
        'Daily free limit reached (5/5). Upgrade to Pro for unlimited AI actions, or try again tomorrow.',
      isLimitReached: true,
      usage: currentUsage,
    });

    return null;
  }

  return authCtx;
}

// Lazy initialization of Gemini API
let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in the environment. Please add it to your project settings.'
    );
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
    });
  }

  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const key = process.env.GEMINI_API_KEY;

  const isConfigured = Boolean(
    key && key !== 'MY_GEMINI_API_KEY'
  );

  res.json({
    status: 'ok',
    hasGeminiKey: isConfigured,
  });
});

// Helper for cleaning markdown JSON fences if Gemini wraps in ```json ...
function parseJsonFromText(rawText: string): any {
  if (!rawText) return null;

  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```$/m, '')
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    try {
      const match = rawText.match(/\{[\s\S]*\}/);

      if (match) {
        return JSON.parse(match[0]);
      }
    } catch {
      // ignore
    }

    return null;
  }
}

// -------------------------------------------------------------
// AI request input validation
// -------------------------------------------------------------

class AiInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Gemini inline requests are limited to ~20 MB in total. Keep the
// decoded file comfortably below that.
const MAX_INLINE_FILE_BYTES = 15 * 1024 * 1024;

// Upper bounds for text sent to AI endpoints.
const MAX_AI_DOCUMENT_CHARS = 2_000_000;
const MAX_TRANSLATION_CHARS = 20_000;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  ...ALLOWED_IMAGE_MIME_TYPES,
]);

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
  fallback = ''
): string {
  if (value === undefined || value === null) return fallback;

  if (typeof value !== 'string') {
    throw new AiInputError(`Invalid ${field}.`);
  }

  if (value.length > maxLength) {
    throw new AiInputError(
      `${field} is too long (maximum ${maxLength.toLocaleString('en-US')} characters).`,
      413
    );
  }

  return value;
}

function pickAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// Parses an optional data URI / raw base64 payload and validates its
// type and decoded size. Returns null when no file was provided.
function parseInlineFile(
  value: unknown,
  declaredMime: unknown,
  allowedTypes: Set<string>,
  fallbackMime: string
): { data: string; mimeType: string } | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new AiInputError('Invalid file data.');
  }

  let data = value;
  let mimeType =
    typeof declaredMime === 'string' && declaredMime
      ? declaredMime
      : fallbackMime;

  const dataUriMatch = value.match(
    /^data:([^;,]+)(?:;[^,]*)?;base64,/
  );

  if (dataUriMatch) {
    mimeType = dataUriMatch[1];
    data = value.slice(dataUriMatch[0].length);
  }

  mimeType = mimeType.trim().toLowerCase();

  if (!allowedTypes.has(mimeType)) {
    throw new AiInputError(
      'Unsupported file type. Please upload a PDF or an image (JPG, PNG, WebP or HEIC).',
      415
    );
  }

  data = data.replace(/\s+/g, '');

  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new AiInputError('The uploaded file data is corrupted or incomplete.');
  }

  const decodedBytes = Math.floor((data.length * 3) / 4);

  if (decodedBytes > MAX_INLINE_FILE_BYTES) {
    throw new AiInputError(
      'File is too large. Please upload a file smaller than 15 MB.',
      413
    );
  }

  return {
    data,
    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
  };
}

// Converts endpoint errors into safe client responses. Validation
// errors keep their message; unexpected errors are logged and a generic
// message is returned so internal details are not exposed.
function sendAiError(
  res: express.Response,
  route: string,
  err: any,
  fallbackMessage: string
) {
  if (err instanceof AiInputError) {
    return res.status(err.status).json({
      error: err.message,
    });
  }

  console.error(`Error in ${route}:`, err?.message || err);

  const message = String(err?.message || '');

  if (message.includes('GEMINI_API_KEY')) {
    return res.status(503).json({
      error:
        'The AI service is not configured on the server yet. Please try again later.',
    });
  }

  if (/timed out/i.test(message)) {
    return res.status(504).json({
      error:
        'The AI service took too long to respond. Please try again.',
    });
  }

  return res.status(502).json({
    error: fallbackMessage,
  });
}

// Resilient helper with dynamic model selection and silent fallback
let preferredModel = 'gemini-3.1-flash-lite';

async function generateWithModelFallback(params: {
  contents: any;
  config?: any;
  timeoutMs?: number;
}): Promise<any> {
  const ai = getAIClient();

  const candidateList = [
    preferredModel,
    ...[
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
    ].filter((m) => m !== preferredModel),
  ];

  let lastError: any = null;

  const timeoutMs = params.timeoutMs || 30000;

  for (const model of candidateList) {
    try {
      const generatePromise = ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Model ${model} request timed out after ${
                  timeoutMs / 1000
                }s`
              )
            ),
          timeoutMs
        );
      });

      const response: any = await Promise.race([
        generatePromise,
        timeoutPromise,
      ]);

      preferredModel = model;

      return response;
    } catch (err: any) {
      lastError = err;

      const msg = err?.message || String(err);

      console.log(
        `[AI Routing] ${model} unavailable, automatically routing to next model...`
      );
    }
  }

  throw lastError;
}

// =============================================================
// 1. PHOTO TO TEXT
// =============================================================

app.post('/api/photo-to-text', async (req, res) => {
  const authCtx = checkAiUsage(req, res);

  if (!authCtx) return;

  try {
    const body = req.body || {};

    const promptHint = optionalString(
      body.promptHint,
      'Instructions',
      1000
    ).trim();

    const image = parseInlineFile(
      body.imageBase64,
      body.mimeType,
      ALLOWED_DOCUMENT_MIME_TYPES,
      'image/jpeg'
    );

    if (!image) {
      return res.status(400).json({
        error: 'Please provide an image or document photo.',
      });
    }

    const parts: any[] = [
      {
        inlineData: image,
      },
    ];

    parts.push({
      text: `You are an expert document OCR and data extraction system.
Analyze the provided document image thoroughly.
1. Transcribe ALL visible text accurately, preserving headings, bullet points, table lines, numbers, and structural layout.
2. Provide a 2-sentence summary of what this document is.
3. Extract 4 to 8 critical structured key-value attributes (e.g., Document Type, Organization/Issuer, Document ID/Ref, Dates, Names, Monetary Amounts, Status, Contact/Address).
${promptHint ? `User specific guidance: ${promptHint}` : ''}

Respond STRICTLY with valid JSON in this exact structure:
{
  "extractedText": "exact transcript of all text in the image",
  "detectedLanguage": "Primary language(s) found",
  "summary": "Brief 2-sentence summary of the document",
  "structuredDetails": [
    {"label": "Attribute name", "value": "Extracted detail"}
  ]
}`,
    });

    const response = await generateWithModelFallback({
      contents: parts,
      config: {
        responseMimeType: 'application/json',
      },
      timeoutMs: 30000,
    });

    const parsed = parseJsonFromText(
      response.text || ''
    );

    if (parsed) {
      incrementDailyUsage(authCtx.identifier);

      const extractedText =
        parsed.extractedText !== undefined
          ? parsed.extractedText
          : (
              parsed.text ||
              parsed.transcript ||
              parsed.transcription ||
              parsed.content ||
              ''
            );

      return res.json({
        extractedText:
          typeof extractedText === 'string' &&
          extractedText.trim()
            ? extractedText
            : 'No readable text could be identified in the image.',

        detectedLanguage:
          parsed.detectedLanguage || 'Auto-detected',

        summary:
          parsed.summary ||
          'Text transcript extracted from document photo.',

        structuredDetails:
          Array.isArray(parsed.structuredDetails)
            ? parsed.structuredDetails
            : [],
      });
    }

    incrementDailyUsage(authCtx.identifier);

    return res.json({
      extractedText:
        response.text ||
        'No readable text could be identified in the image.',

      detectedLanguage: 'Auto-detected',

      summary:
        'Text transcript extracted from document image.',

      structuredDetails: [],
    });
  } catch (err: any) {
    sendAiError(
      res,
      '/api/photo-to-text',
      err,
      'Failed to process document photo. Please verify image clarity and try again.'
    );
  }
});

// =============================================================
// 2. PDF SUMMARY
// =============================================================

app.post('/api/pdf-summary', async (req, res) => {
  const authCtx = checkAiUsage(req, res);

  if (!authCtx) return;

  try {
    const body = req.body || {};

    const documentText = optionalString(
      body.documentText,
      'Document text',
      MAX_AI_DOCUMENT_CHARS
    );

    const title =
      optionalString(body.title, 'Title', 300).trim() ||
      'Document';

    const language = pickAllowed(
      body.language,
      ['English', 'Hindi'] as const,
      'English'
    );

    const file = parseInlineFile(
      body.fileBase64,
      body.mimeType,
      ALLOWED_DOCUMENT_MIME_TYPES,
      'application/pdf'
    );

    if (!documentText.trim() && !file) {
      return res.status(400).json({
        error:
          'Please provide document text or upload a file to summarize.',
      });
    }

    const parts: any[] = [];

    if (file) {
      parts.push({
        inlineData: file,
      });
    }

    const textTruncated =
      documentText.length > 45000;

    const promptInstructions = `You are a premier executive document analyst. Analyze this document thoroughly and generate a crisp, highly actionable summary in ${language}.
Document Title/Context: ${title}
${
  documentText
    ? `Document Text Content:\n${documentText.slice(
        0,
        45000
      )}`
    : ''
}

Output STRICTLY valid JSON with this exact schema:
{
  "title": "Clear, informative document title",
  "summary": "Comprehensive 2-3 paragraph executive summary explaining the core purpose, obligations, and key terms",
  "keyPoints": [
    "Crucial point 1",
    "Crucial point 2",
    "Crucial point 3",
    "Crucial point 4"
  ],
  "actionItems": [
    "Immediate action or obligation required",
    "Secondary requirement or compliance check"
  ],
  "importantDatesOrNumbers": [
    "Key date, financial figure, or deadline with context",
    "Another critical number or period"
  ]
}`;

    parts.push({
      text: promptInstructions,
    });

    const response = await generateWithModelFallback({
      contents: parts,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(
      response.text || ''
    );

    incrementDailyUsage(authCtx.identifier);

    if (parsed && parsed.summary) {
      // The app renders these as lists; never send a missing or non-array value.
      const toStringList = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item) => typeof item === 'string')
          : [];

      return res.json({
        ...parsed,
        keyPoints: toStringList(parsed.keyPoints),
        actionItems: toStringList(parsed.actionItems),
        importantDatesOrNumbers: toStringList(parsed.importantDatesOrNumbers),
        truncated: textTruncated,
      });
    }

    return res.json({
      truncated: textTruncated,
      title: title || 'Document Summary',
      summary: response.text || 'Summary generated.',
      keyPoints: [],
      actionItems: [],
      importantDatesOrNumbers: [],
    });
  } catch (err: any) {
    sendAiError(
      res,
      '/api/pdf-summary',
      err,
      'Failed to summarize document. Please ensure document contents are readable.'
    );
  }
});

// =============================================================
// 3. ASK DOCUMENT
// =============================================================

app.post('/api/ask-document', async (req, res) => {
  const authCtx = checkAiUsage(req, res);

  if (!authCtx) return;

  try {
    const body = req.body || {};

    const question = optionalString(
      body.question,
      'Question',
      2000
    );

    const documentContext = optionalString(
      body.documentContext,
      'Document',
      MAX_AI_DOCUMENT_CHARS
    );

    if (!question.trim()) {
      return res.status(400).json({
        error: 'Please enter a question to ask.',
      });
    }

    if (!documentContext.trim()) {
      return res.status(400).json({
        error:
          'Document context is required to answer questions.',
      });
    }

    const prompt = `You are an expert AI Document Intelligence assistant.
Answer the user's inquiry strictly and truthfully based on the provided document context.

Rules:
1. If the answer is in the document, explain it clearly and provide 1-3 direct quotes/citations in "relevantExcerpts".
2. If the document does not mention the answer, clearly say so without hallucinating or making up facts.
3. Suggest 3 useful follow-up questions the user can ask next about this specific document.

Document Context:
${documentContext.slice(0, 40000)}

User Question:
${question}

Return STRICTLY valid JSON:
{
  "answer": "Direct, structured and clear answer to the user's question",
  "relevantExcerpts": [
    "Exact citation or quote from the text that proves the answer"
  ],
  "suggestedQuestions": [
    "Follow-up question 1",
    "Follow-up question 2",
    "Follow-up question 3"
  ]
}`;

    const response = await generateWithModelFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(
      response.text || ''
    );

    incrementDailyUsage(authCtx.identifier);

    const contextTruncated =
      documentContext.length > 40000;

    if (parsed && parsed.answer) {
      return res.json({
        ...parsed,
        truncated: contextTruncated,
      });
    }

    return res.json({
      answer:
        response.text ||
        'Unable to generate answer from document.',

      relevantExcerpts: [],
      suggestedQuestions: [],
      truncated: contextTruncated,
    });
  } catch (err: any) {
    sendAiError(
      res,
      '/api/ask-document',
      err,
      'Failed to answer question on document.'
    );
  }
});

// =============================================================
// 4. HINDI ENGLISH TRANSLATION
// =============================================================

app.post('/api/hindi-translation', async (req, res) => {
  const authCtx = checkAiUsage(req, res);

  if (!authCtx) return;

  try {
    const body = req.body || {};

    // Translation output must be complete, so oversized input is
    // rejected instead of being silently cut.
    const text = optionalString(
      body.text,
      'Text to translate',
      MAX_TRANSLATION_CHARS
    );

    const sourceLang = pickAllowed(
      body.sourceLang,
      ['Auto', 'English', 'Hindi'] as const,
      'Auto'
    );

    const targetLang = pickAllowed(
      body.targetLang,
      ['Hindi', 'English'] as const,
      'Hindi'
    );

    if (!text.trim()) {
      return res.status(400).json({
        error: 'Please provide text to translate.',
      });
    }

    const prompt = `You are a certified Hindi-English legal, official, and technical translator.
Translate the text faithfully and accurately, maintaining appropriate formal tone (administrative/legal/academic).

Source Language: ${sourceLang}
Target Language: ${targetLang}

Input Text to translate:
${text}

Requirements:
1. "translatedText": Professional, high-quality translation in appropriate Devanagari Hindi or English.
2. "sourceLang": The actual detected source language.
3. "targetLang": "${targetLang}".
4. "romanizedPronunciation": If the target is Hindi, provide the phonetic Roman script (Hinglish) transliteration to help English speakers pronounce it correctly. If target is English, provide a brief phonetic guide if relevant or omit.
5. "glossary": Extract 2 to 5 key official/administrative/legal terminology items found in the text with plain-language explanations in both languages.

Output STRICTLY valid JSON:
{
  "translatedText": "Full translation",
  "sourceLang": "Detected source language",
  "targetLang": "${targetLang}",
  "romanizedPronunciation": "Phonetic transliteration",
  "glossary": [
    {"term": "Term in source/target", "explanation": "Clear explanation of meaning"}
  ]
}`;

    const response = await generateWithModelFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(
      response.text || ''
    );

    incrementDailyUsage(authCtx.identifier);

    if (parsed && parsed.translatedText) {
      return res.json({
        ...parsed,
        glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
      });
    }

    return res.json({
      translatedText: response.text || '',
      sourceLang,
      targetLang,
      glossary: [],
    });
  } catch (err: any) {
    sendAiError(
      res,
      '/api/hindi-translation',
      err,
      'Failed to translate document text.'
    );
  }
});

// =============================================================
// 5. AI WRITER
// =============================================================

app.post('/api/ai-writer', async (req, res) => {
  const authCtx = checkAiUsage(req, res);

  if (!authCtx) return;

  try {
    const body = req.body || {};

    const docType =
      optionalString(body.docType, 'Document type', 120).trim() ||
      'Formal Letter';
    const topic = optionalString(body.topic, 'Topic', 2000);
    const keyPoints = optionalString(
      body.keyPoints,
      'Key points',
      10000
    );
    const recipient = optionalString(
      body.recipient,
      'Recipient',
      500
    );
    const tone =
      optionalString(body.tone, 'Tone', 120).trim() ||
      'Formal & Respectful';
    const language = pickAllowed(
      body.language,
      ['English', 'Hindi'] as const,
      'English'
    );

    if (
      !topic.trim() &&
      !keyPoints.trim()
    ) {
      return res.status(400).json({
        error:
          'Please enter a topic or key points for the document.',
      });
    }

    const prompt = `You are a professional legal, corporate, and administrative drafting expert.
Draft a complete, official, ready-to-use document based on the following specifications:

Document Type: ${docType}
Subject / Core Purpose: ${topic}
Recipient / Addressing Authority: ${
      recipient || 'Appropriate Authority'
    }
Tone: ${tone}
Target Language: ${language} (If Hindi, draft in formal Devanagari Hindi with appropriate official honorifics and closing)
Specific Details & Points to Include:
${keyPoints || 'Standard professional requirements for this document type'}

Instructions:
- Include proper document structure: Header, Date placeholder, Recipient block, Subject line, Salutation, clear structured body paragraphs, polite closing, and Signature block with brackets like [Your Name], [Contact Information].
- Add 2 to 4 practical, actionable tips for submitting or filing this document (e.g. required enclosures, stamp duty, proof of service, or record keeping).

Return STRICTLY valid JSON:
{
  "title": "Document Title",
  "content": "Complete ready-to-use text of the letter/document",
  "tips": [
    "Practical submission or filing tip 1",
    "Practical submission or filing tip 2"
  ]
}`;

    const response = await generateWithModelFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(
      response.text || ''
    );

    incrementDailyUsage(authCtx.identifier);

    if (parsed && parsed.content) {
      return res.json({
        ...parsed,
        tips: Array.isArray(parsed.tips)
          ? parsed.tips.filter((tip: unknown) => typeof tip === 'string')
          : [],
      });
    }

    return res.json({
      title: `${docType}: ${topic}`,
      content: response.text || '',
      tips: [
        'Review placeholders before printing or sending.',
      ],
    });
  } catch (err: any) {
    sendAiError(
      res,
      '/api/ai-writer',
      err,
      'Failed to draft document with AI.'
    );
  }
});

// =============================================================
// 6. UNIVERSAL QUICK ACTION
// =============================================================

app.post('/api/quick-action', async (req, res) => {
  const authCtx = checkAiUsage(req, res);

  if (!authCtx) return;

  try {
    const body = req.body || {};
    const action = body.action;

    const text = optionalString(
      body.text,
      'Text',
      MAX_AI_DOCUMENT_CHARS
    );

    const title =
      optionalString(body.title, 'Title', 300).trim() ||
      'Document';

    if (!text.trim()) {
      return res.status(400).json({
        error:
          'Text content is required for quick action.',
      });
    }

    let prompt = '';

    if (action === 'extract-points') {
      prompt = `You are an expert document analyst. Extract 4 to 7 crucial key points from this document.
Document: ${title}
Content:
${text.slice(0, 30000)}

Return STRICTLY valid JSON:
{
  "title": "Key Points: ${title}",
  "headline": "One sentence executive verdict",
  "keyPoints": [
    "Crucial point 1",
    "Crucial point 2"
  ]
}`;
    } else if (action === 'make-notes') {
      prompt = `You are a professional note-taking assistant. Convert this document text into organized, clean study/action notes.
Document: ${title}
Content:
${text.slice(0, 30000)}

Return STRICTLY valid JSON:
{
  "title": "Meeting & Document Notes: ${title}",
  "takeaway": "Core takeaway message",
  "sections": [
    {"heading": "Section Heading", "notes": ["Note bullet 1", "Note bullet 2"]}
  ],
  "checklist": [
    "Actionable to-do or compliance item 1",
    "Actionable to-do item 2"
  ]
}`;
    } else if (
      action === 'find-entities' ||
      action === 'smart-extract'
    ) {
      prompt = `You are a forensic document data extractor and entity recognition specialist.
Extract ALL relevant structured entities from this document:
1. Names: People, companies, institutions, authorities with their role (e.g. Tenant, Landlord, Branch Manager, Beneficiary).
2. Dates & Deadlines: Effective dates, termination dates, due dates, notice periods, payment schedules with context.
3. Monetary Amounts: Rent, security deposits, fees, penalties, taxes, salary, totals with currency symbols.
4. Contacts: Phone numbers, mobile numbers, emergency contacts, emails, web URLs.
5. Addresses: Property addresses, registered office locations, correspondence addresses.
6. Key Identifiers: Document/Agreement numbers, Invoice numbers, Account/Meter numbers, Govt IDs (PAN, GSTIN, Aadhaar references, etc.).
7. Key Information: 2-4 critical rules, terms, or obligations.

Document: ${title}
Content:
${text.slice(0, 35000)}

Return STRICTLY valid JSON:
{
  "title": "Smart Extraction: ${title}",
  "names": [
    {"value": "Full Name / Organization", "role": "Party role / title"}
  ],
  "dates": [
    {"value": "Date / Period", "context": "Significance of this date"}
  ],
  "amounts": [
    {"value": "₹ / $ Amount", "description": "Purpose of payment or charge"}
  ],
  "contacts": [
    {"type": "phone", "value": "+91 98765 43210", "label": "Direct / Helpline"},
    {"type": "email", "value": "support@example.com", "label": "Official contact email"}
  ],
  "addresses": [
    {"value": "Full address string", "type": "Property / Office / Billing"}
  ],
  "identifiers": [
    {"type": "ID Type (e.g. Agreement ID, Meter No, GSTIN)", "value": "ID Value", "description": "What this refers to"}
  ],
  "keyInformation": [
    {"category": "Category name", "detail": "Specific term, condition, or clause"}
  ]
}`;
    } else {
      return res.status(400).json({
        error: 'Invalid quick action type.',
      });
    }

    const response = await generateWithModelFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(
      response.text || ''
    );

    incrementDailyUsage(authCtx.identifier);

    if (parsed) {
      return res.json({
        success: true,
        data: parsed,
      });
    }

    return res.json({
      success: true,
      data: {
        title: `${action}: ${title}`,
        rawText: response.text,
      },
    });
  } catch (err: any) {
    sendAiError(
      res,
      '/api/quick-action',
      err,
      'Failed to execute quick action.'
    );
  }
});

// =============================================================
// AUTH & USER ACCOUNT ROUTES
// =============================================================

function serializeUser(user: StoredUser) {
  const proActive = isProActive(user);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: proActive ? 'pro' : 'free',
    role: isUserAdmin(user) ? 'admin' : 'user',
    isAdmin: isUserAdmin(user),
    proUntil: proActive ? user.proUntil : undefined,
    createdAt: user.createdAt,
    preferredLanguage: user.preferredLanguage,
    avatarUrl: user.avatarUrl,
    authProvider:
      user.authProvider ||
      (user.googleId ? 'google' : 'password'),
    // Lets the app offer "Change password" only to accounts that have one.
    hasPassword: Boolean(user.passwordHash && user.salt),
  };
}

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/auth/register', (req, res) => {
  try {
    const {
      name,
      email,
      password,
    } = req.body;

    if (
      !email ||
      !password ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({
        error:
          'Email and password are required.',
      });
    }

    if (
      email.length > 254 ||
      !EMAIL_PATTERN.test(email.trim())
    ) {
      return res.status(400).json({
        error:
          'Please enter a valid email address.',
      });
    }

    if (
      name !== undefined &&
      name !== null &&
      typeof name !== 'string'
    ) {
      return res.status(400).json({
        error:
          'Invalid name.',
      });
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        error:
          'Password must be at least 6 characters long.',
      });
    }

    if (password.length > PASSWORD_MAX_LENGTH) {
      return res.status(400).json({
        error:
          `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`,
      });
    }

    const {
      user,
      token,
    } = registerUser(
      name || '',
      email,
      password
    );

    const usage = getUserUsage(user);

    res.json({
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    res.status(400).json({
      error:
        err.message ||
        'Failed to register account.',
    });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const {
      email,
      password,
    } = req.body;

    if (
      !email ||
      !password ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.length > 254 ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      return res.status(400).json({
        error:
          'Email and password are required.',
      });
    }

    const {
      user,
      token,
    } = authenticateUser(
      email,
      password
    );

    const usage = getUserUsage(user);

    res.json({
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    res.status(401).json({
      error:
        err.message ||
        'Authentication failed.',
    });
  }
});

// =============================================================
// GOOGLE OAUTH 2.0 INTEGRATION
// =============================================================

interface OAuthStateData {
  redirectUri: string;
  createdAt: number;
}

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

const OAUTH_CALLBACK_PATHS = [
  '/auth/google/callback',
  '/auth/callback',
];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON that is safe to embed inside an inline <script> block.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Only redirect URIs pointing at this app's own callback paths
// are accepted, preventing authorization codes being sent elsewhere.
function getAllowedOAuthRedirectUris(
  req: express.Request
): Set<string> {
  const allowed = new Set<string>();

  const appUrl =
    (process.env.APP_URL || '').trim().replace(/\/$/, '');

  const origins: string[] = [];

  if (/^https?:\/\//i.test(appUrl)) {
    origins.push(appUrl);
  }

  const host = req.get('host');

  if (host) {
    origins.push(`${req.protocol}://${host}`);
  }

  for (const origin of origins) {
    for (const callbackPath of OAUTH_CALLBACK_PATHS) {
      allowed.add(`${origin}${callbackPath}`);
    }
  }

  for (const extra of (process.env.GOOGLE_OAUTH_REDIRECT_URIS || '').split(',')) {
    const trimmed = extra.trim();

    if (trimmed) {
      allowed.add(trimmed);
    }
  }

  return allowed;
}

function getOriginOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const googleOAuthStates =
  new Map<string, OAuthStateData>();

setInterval(() => {
  const now = Date.now();

  for (
    const [state, data]
    of googleOAuthStates.entries()
  ) {
    if (
      now - data.createdAt >
      15 * 60 * 1000
    ) {
      googleOAuthStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

const GOOGLE_WEB_CLIENT_ID =
  (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.CLIENT_ID ||
    '358349564336-v9fq2to3b94q8482en0pt9f3b58scfgs.apps.googleusercontent.com'
  ).trim();

const GOOGLE_ANDROID_CLIENT_ID =
  '358349564336-onvft9bdjre63q7gttnlbosfr3ll68ss.apps.googleusercontent.com';

app.get('/api/auth/google/status', (req, res) => {
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.CLIENT_SECRET;

  const isConfigured = Boolean(
    GOOGLE_WEB_CLIENT_ID &&
      clientSecret &&
      clientSecret.trim() !== ''
  );

  res.json({
    configured: isConfigured,
    clientId: GOOGLE_WEB_CLIENT_ID,
  });
});

app.get('/api/auth/google/url', (req, res) => {
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.CLIENT_SECRET;

  if (
    !GOOGLE_WEB_CLIENT_ID ||
    !clientSecret ||
    clientSecret.trim() === ''
  ) {
    return res.status(400).json({
      configured: false,
      error:
        'Google OAuth Web credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not fully configured in environment settings.',
    });
  }

  const requestedRedirectUri =
    (req.query.redirect_uri as string) || '';

  const appUrl =
    (process.env.APP_URL || '').replace(/\/$/, '');

  const redirectUri =
    requestedRedirectUri ||
    (
      appUrl
        ? `${appUrl}/auth/google/callback`
        : `${req.protocol}://${req.get(
            'host'
          )}/auth/google/callback`
    );

  if (
    typeof redirectUri !== 'string' ||
    !getAllowedOAuthRedirectUris(req).has(redirectUri)
  ) {
    return res.status(400).json({
      configured: true,
      error:
        'The requested OAuth redirect URI is not allowed.',
    });
  }

  const state =
    crypto.randomBytes(24).toString('hex');

  googleOAuthStates.set(state, {
    redirectUri,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  res.json({
    configured: true,
    url: authUrl,
    state,
  });
});

// =============================================================
// NATIVE GOOGLE SIGN-IN
// =============================================================

app.post('/api/auth/google/native', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (
      !idToken ||
      typeof idToken !== 'string' ||
      idToken.trim().length === 0
    ) {
      return res.status(400).json({
        error:
          'Missing required Google ID token from Credential Manager.',
      });
    }

    const verifyRes =
      await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
          idToken.trim()
        )}`
      );

    if (!verifyRes.ok) {
      const errData =
        await verifyRes
          .json()
          .catch(() => ({}));

      console.error(
        '[GoogleAuth] Cryptographic ID token verification failed:',
        errData
      );

      return res.status(401).json({
        error:
          'Google ID token verification failed. The provided token is invalid, expired, or untrusted.',
      });
    }

    const payload =
      await verifyRes.json();

    const validAudiences = [
      GOOGLE_WEB_CLIENT_ID,
      GOOGLE_ANDROID_CLIENT_ID,
    ];

    const tokenAud = payload.aud;

    if (
      !tokenAud ||
      !validAudiences.includes(tokenAud)
    ) {
      console.error(
        `[GoogleAuth] Audience mismatch. Expected one of: ${validAudiences.join(
          ', '
        )}, got: ${tokenAud}`
      );

      return res.status(401).json({
        error:
          'Google token audience mismatch. Token was not minted for this application.',
      });
    }

    const validIssuers = [
      'accounts.google.com',
      'https://accounts.google.com',
    ];

    if (
      !payload.iss ||
      !validIssuers.includes(payload.iss)
    ) {
      return res.status(401).json({
        error:
          'Google token issuer is untrusted.',
      });
    }

    const nowSec =
      Math.floor(Date.now() / 1000);

    if (
      payload.exp &&
      Number(payload.exp) < nowSec
    ) {
      return res.status(401).json({
        error:
          'Google ID token has expired.',
      });
    }

    if (
      payload.email_verified !== 'true' &&
      payload.email_verified !== true
    ) {
      return res.status(401).json({
        error:
          'Google account email is not verified.',
      });
    }

    const verifiedEmail =
      payload.email
        ?.toLowerCase()
        .trim();

    if (
      !verifiedEmail ||
      !verifiedEmail.includes('@')
    ) {
      return res.status(400).json({
        error:
          'Google did not return a valid verified email address.',
      });
    }

    const verifiedSub =
      payload.sub;

    if (
      !verifiedSub ||
      typeof verifiedSub !== 'string'
    ) {
      return res.status(401).json({
        error:
          'Google token is missing a valid account identifier.',
      });
    }

    const verifiedName =
      payload.name ||
      payload.given_name ||
      verifiedEmail.split('@')[0] ||
      'Google User';

    const verifiedPicture =
      payload.picture ||
      undefined;

    const {
      user,
      token,
    } =
      findOrCreateGoogleUser({
        googleId: verifiedSub,
        email: verifiedEmail,
        name: verifiedName,
        avatarUrl: verifiedPicture,
      });

    const usage = getUserUsage(user);

    console.log(
      `[GoogleAuth] Cryptographically verified and authenticated Android user: ${user.email}`
    );

    res.json({
      success: true,
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    console.error(
      'Android Google auth error:',
      err
    );

    res.status(500).json({
      error:
        'Failed to authenticate with verified Google account.',
    });
  }
});

// =============================================================
// GOOGLE OAUTH CALLBACK
// =============================================================

app.get(
  [
    '/auth/google/callback',
    '/auth/google/callback/',
    '/auth/callback',
    '/auth/callback/',
  ],
  async (req, res) => {
    const {
      code,
      state,
      error: oauthError,
    } = req.query;

    if (oauthError) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Sign-In Cancelled</title>
          </head>
          <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #334155;max-width:340px;">
              <h3 style="margin:0 0 8px 0;color:#f87171;">Sign-In Cancelled</h3>
              <p style="color:#94a3b8;font-size:13px;margin:0 0 16px 0;">Google sign-in was cancelled or access was denied.</p>
              <button onclick="window.close()" style="background:#3b82f6;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:600;">Close</button>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage(
                  {
                    type: 'GOOGLE_AUTH_ERROR',
                    error: 'Google sign-in was cancelled.'
                  },
                  '*'
                );

                setTimeout(() => {
                  window.close();
                }, 1200);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    }

    if (
      !code ||
      typeof code !== 'string'
    ) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorization Failed</title>
          </head>
          <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
              <h3 style="margin:0 0 8px 0;color:#f87171;">Authorization Failed</h3>
              <p style="color:#94a3b8;font-size:13px;margin:0;">Missing authorization code from Google.</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage(
                  {
                    type: 'GOOGLE_AUTH_ERROR',
                    error: 'Missing authorization code from Google.'
                  },
                  '*'
                );

                setTimeout(() => {
                  window.close();
                }, 1500);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    }

    const clientId =
      process.env.GOOGLE_CLIENT_ID ||
      process.env.CLIENT_ID;

    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET ||
      process.env.CLIENT_SECRET;

    if (
      !clientId ||
      !clientSecret
    ) {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Configuration Missing</title>
          </head>
          <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
              <h3 style="margin:0 0 8px 0;color:#f87171;">Configuration Missing</h3>
              <p style="color:#94a3b8;font-size:13px;margin:0;">GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured in environment.</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage(
                  {
                    type: 'GOOGLE_AUTH_ERROR',
                    error: 'Server is missing GOOGLE_CLIENT_SECRET.'
                  },
                  '*'
                );

                setTimeout(() => {
                  window.close();
                }, 2000);
              }
            </script>
          </body>
        </html>
      `);
    }

    const stateData =
      typeof state === 'string'
        ? googleOAuthStates.get(state)
        : undefined;

    if (typeof state === 'string') {
      googleOAuthStates.delete(state);
    }

    // The state parameter is mandatory (CSRF / login-forgery protection).
    if (
      !stateData ||
      Date.now() - stateData.createdAt >
        OAUTH_STATE_TTL_MS
    ) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Sign-In Expired</title>
          </head>
          <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
              <h3 style="margin:0 0 8px 0;color:#f87171;">Sign-In Expired</h3>
              <p style="color:#94a3b8;font-size:13px;margin:0;">This sign-in request is invalid or has expired. Please try again.</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage(
                  {
                    type: 'GOOGLE_AUTH_ERROR',
                    error: 'Sign-in request expired. Please try again.'
                  },
                  '*'
                );

                setTimeout(() => {
                  window.close();
                }, 2000);
              }
            </script>
          </body>
        </html>
      `);
    }

    const redirectUri =
      stateData.redirectUri;

    // Session tokens are only ever posted to this app's own origin.
    const postMessageTargetOrigin =
      getOriginOf(redirectUri) ||
      `${req.protocol}://${req.get('host')}`;

    try {
      const tokenRes =
        await fetch(
          'https://oauth2.googleapis.com/token',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded',
            },
            body:
              new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type:
                  'authorization_code',
              }).toString(),
          }
        );

      if (!tokenRes.ok) {
        const errText =
          await tokenRes.text();

        console.error(
          'Google token exchange failed:',
          errText
        );

        throw new Error(
          `Google token exchange failed: ${tokenRes.status}`
        );
      }

      const tokenPayload =
        (await tokenRes.json()) as any;

      const accessToken =
        tokenPayload.access_token;

      const userRes =
        await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
            },
          }
        );

      if (!userRes.ok) {
        throw new Error(
          'Failed to retrieve user profile from Google.'
        );
      }

      const profile =
        (await userRes.json()) as any;

      if (!profile.email || typeof profile.email !== 'string') {
        throw new Error(
          'Google did not provide an email address.'
        );
      }

      // Never link or create accounts for unverified Google emails.
      if (
        profile.email_verified !== true &&
        profile.email_verified !== 'true'
      ) {
        throw new Error(
          'Google account email is not verified.'
        );
      }

      if (!profile.sub || typeof profile.sub !== 'string') {
        throw new Error(
          'Google did not provide a valid account identifier.'
        );
      }

      const {
        user,
        token,
      } =
        findOrCreateGoogleUser({
          googleId: profile.sub,
          email: profile.email,
          name:
            profile.name ||
            profile.given_name ||
            'Google User',
          avatarUrl:
            profile.picture,
        });

      const usage = getUserUsage(user);

      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Google Sign-In Successful</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background-color: #0f172a;
                color: #f8fafc;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }

              .card {
                text-align: center;
                padding: 24px;
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 16px;
                max-width: 320px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
              }

              .icon {
                width: 44px;
                height: 44px;
                margin: 0 auto 12px;
                background: rgba(16, 185, 129, 0.2);
                border: 1px solid rgba(16, 185, 129, 0.4);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #34d399;
                font-size: 22px;
              }
            </style>
          </head>

          <body>
            <div class="card">
              <div class="icon">✓</div>

              <h3 style="margin:0 0 6px 0;font-size:17px;font-weight:600;">
                Welcome, ${escapeHtml(user.name)}!
              </h3>

              <p style="color:#94a3b8;font-size:13px;margin:0 0 12px 0;">
                Google account connected. Closing this window...
              </p>
            </div>

            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage(
                    {
                      type: 'GOOGLE_AUTH_SUCCESS',
                      token: ${jsonForScript(token)},
                      user: ${jsonForScript(
                        serializeUser(user)
                      )},
                      usage: ${jsonForScript(
                        usage
                      )}
                    },
                    ${jsonForScript(postMessageTargetOrigin)}
                  );

                  setTimeout(() => {
                    window.close();
                  }, 500);
                } else {
                  window.location.href = '/';
                }
              } catch (e) {
                console.error(e);
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error(
        'Google OAuth error:',
        err
      );

      res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Failed</title>
          </head>

          <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
              <h3 style="margin:0 0 8px 0;color:#f87171;">
                Sign-In Failed
              </h3>

              <p style="color:#94a3b8;font-size:13px;margin:0 0 16px 0;">
                ${escapeHtml(err.message || 'Unable to complete Google authentication.')}
              </p>

              <button
                onclick="window.close()"
                style="background:#475569;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;"
              >
                Close
              </button>
            </div>

            <script>
              if (window.opener) {
                window.opener.postMessage(
                  {
                    type: 'GOOGLE_AUTH_ERROR',
                    error: ${jsonForScript(
                      err.message ||
                        'Google authentication failed.'
                    )}
                  },
                  '*'
                );

                setTimeout(() => {
                  window.close();
                }, 2500);
              }
            </script>
          </body>
        </html>
      `);
    }
  }
);

// =============================================================
// AUTH ME / PROFILE / LOGOUT / DELETE
// =============================================================

// Google Play renews subscriptions without the app being involved, so
// when a verified subscription's stored expiry has passed, re-check it
// with Google before treating the user as Free. Attempts are throttled
// per user and failures never remove access that Google still reports.
const entitlementRefreshAttempts = new Map<string, number>();

async function refreshExpiredGooglePlayEntitlement(
  user: StoredUser
): Promise<void> {
  const now = Date.now();

  if (
    user.plan === 'pro' &&
    (user.proUntil == null || user.proUntil > now)
  ) {
    return;
  }

  const staleRecords = getUserGooglePlayPurchases(user.id)
    .filter(
      (p) =>
        p.state === 'VERIFIED' &&
        typeof p.expiryTime === 'number' &&
        p.expiryTime <= now
    )
    .sort((a, b) => (b.expiryTime || 0) - (a.expiryTime || 0))
    .slice(0, 5);

  if (staleRecords.length === 0) {
    return;
  }

  const lastAttempt = entitlementRefreshAttempts.get(user.id) || 0;

  if (now - lastAttempt < 10 * 60 * 1000) {
    return;
  }

  entitlementRefreshAttempts.set(user.id, now);

  for (const record of staleRecords) {
    const result = await verifyGooglePlaySubscriptionForUser(
      record.purchaseToken,
      user
    );

    if (result.status === 'active') {
      updateUserPlan(user.id, 'pro', result.record.expiryTime);
      return;
    }

    if (result.status === 'inactive') {
      try {
        recordGooglePlayPurchase({
          ...record,
          state: 'EXPIRED',
          verifiedAt: Date.now(),
        });
      } catch (markErr) {
        console.error(
          '[Google Play Billing] Failed to mark purchase inactive:',
          markErr
        );
      }
    }
  }
}

app.get('/api/auth/me', async (req, res) => {
  const sessionToken = getTokenFromRequest(req);
  const sessionUser = sessionToken
    ? getUserByToken(sessionToken)
    : null;

  if (sessionUser) {
    try {
      await refreshExpiredGooglePlayEntitlement(sessionUser);
    } catch (refreshErr: any) {
      console.error(
        '[Google Play Billing] Entitlement refresh failed:',
        refreshErr?.message || refreshErr
      );
    }
  }

  const {
    user,
    identifier,
    isPro,
  } = getAuthContext(req);

  if (!user) {
    const usage =
      getDailyUsage(
        identifier,
        isPro
      );

    return res.json({
      authenticated: false,
      user: null,
      usage,
    });
  }

  const usage =
    getUserUsage(user);

  res.json({
    authenticated: true,
    user: serializeUser(user),
    usage,
  });
});

app.put('/api/auth/profile', (req, res) => {
  const { user } =
    getAuthContext(req);

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized.',
    });
  }

  try {
    const {
      name,
      preferredLanguage,
    } = req.body;

    const updated =
      updateUserProfile(
        user.id,
        {
          name,
          preferredLanguage,
        }
      );

    res.json({
      user: serializeUser(updated),
    });
  } catch (err: any) {
    res.status(400).json({
      error:
        err.message ||
        'Failed to update profile.',
    });
  }
});

// =============================================================
// PASSWORD CHANGE & EMAIL PASSWORD RESET
// =============================================================

app.post('/api/auth/change-password', (req, res) => {
  const { user } = getAuthContext(req);

  if (!user) {
    return res.status(401).json({
      error: 'Please sign in again.',
    });
  }

  const { currentPassword, newPassword } = req.body || {};

  if (!user.passwordHash || !user.salt) {
    return res.status(400).json({
      error:
        'This account signs in with Google, so it has no password to change.',
    });
  }

  if (!verifyUserPassword(user.id, currentPassword)) {
    return res.status(400).json({
      error: 'Your current password is incorrect.',
    });
  }

  try {
    setUserPassword(user.id, newPassword);

    // All old sessions were revoked; issue a fresh one for this device.
    const token = createSession(user.id);

    res.json({
      success: true,
      token,
      user: serializeUser(user),
      message:
        'Password changed. Other devices have been signed out.',
    });
  } catch (err: any) {
    res.status(400).json({
      error: err.message || 'Failed to change password.',
    });
  }
});

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_EMAIL_INTERVAL_MS = 2 * 60 * 1000;

// Reset tokens are single-use and kept only in memory as SHA-256
// hashes. A restart invalidates outstanding links; users simply
// request a new one.
const passwordResetTokens = new Map<
  string,
  { userId: string; expiresAt: number }
>();

const passwordResetLastSent = new Map<string, number>();

setInterval(() => {
  const now = Date.now();

  for (const [hash, data] of passwordResetTokens.entries()) {
    if (data.expiresAt <= now) {
      passwordResetTokens.delete(hash);
    }
  }

  for (const [email, sentAt] of passwordResetLastSent.entries()) {
    if (now - sentAt > PASSWORD_RESET_EMAIL_INTERVAL_MS) {
      passwordResetLastSent.delete(email);
    }
  }
}, 5 * 60 * 1000).unref?.();

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getPasswordResetConfig(): {
  apiKey: string;
  from: string;
  appUrl: string;
} | null {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.PASSWORD_RESET_EMAIL_FROM || '').trim();
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');

  // APP_URL is required so reset links are never built from the
  // request Host header (host-header poisoning).
  if (!apiKey || !from || !/^https:\/\//i.test(appUrl)) {
    return null;
  }

  return { apiKey, from, appUrl };
}

async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string,
  config: { apiKey: string; from: string }
): Promise<void> {
  const safeName = escapeHtml(name || 'there');
  const safeUrl = escapeHtml(resetUrl);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject: 'Reset your AI Document Helper password',
      text:
        `Hi ${name || 'there'},\n\n` +
        `Use this link to set a new password for AI Document Helper. ` +
        `It expires in 30 minutes and can be used once:\n\n${resetUrl}\n\n` +
        `If you did not request this, you can ignore this email.`,
      html:
        `<p>Hi ${safeName},</p>` +
        `<p>Use the link below to set a new password for AI Document Helper. It expires in 30 minutes and can be used once.</p>` +
        `<p><a href="${safeUrl}">Reset my password</a></p>` +
        `<p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Email provider returned status ${response.status}`
    );
  }
}

app.get('/api/auth/password-reset/status', (req, res) => {
  res.json({
    available: Boolean(getPasswordResetConfig()),
  });
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  const config = getPasswordResetConfig();

  if (!config) {
    return res.status(503).json({
      error:
        'Password reset by email is not available yet. Please sign in with Google if your account uses the same Gmail address, or contact support.',
    });
  }

  const email =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      error: 'Please enter a valid email address.',
    });
  }

  // The response is identical whether or not the account exists, so
  // this endpoint cannot be used to discover registered emails.
  const genericResponse = {
    success: true,
    message:
      'If an account exists for this email, a password reset link has been sent. Please check your inbox and spam folder.',
  };

  const user = findUserByEmail(email);

  const lastSent = passwordResetLastSent.get(email) || 0;

  if (
    !user ||
    user.email.toLowerCase() === OWNER_EMAIL ||
    Date.now() - lastSent < PASSWORD_RESET_EMAIL_INTERVAL_MS
  ) {
    return res.json(genericResponse);
  }

  passwordResetLastSent.set(email, Date.now());

  // Only one active reset link per user.
  for (const [hash, data] of passwordResetTokens.entries()) {
    if (data.userId === user.id) {
      passwordResetTokens.delete(hash);
    }
  }

  const token = crypto.randomBytes(32).toString('hex');

  passwordResetTokens.set(hashResetToken(token), {
    userId: user.id,
    expiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
  });

  // The token is placed in the URL fragment so it is not sent to the
  // server or proxies when the page loads.
  const resetUrl = `${config.appUrl}/reset-password#token=${token}`;

  try {
    await sendPasswordResetEmail(user.email, user.name, resetUrl, config);
  } catch (err: any) {
    console.error(
      '[PasswordReset] Failed to send reset email:',
      err?.message || err
    );

    passwordResetTokens.delete(hashResetToken(token));
    passwordResetLastSent.delete(email);

    return res.status(502).json({
      error:
        'We could not send the reset email right now. Please try again later.',
    });
  }

  res.json(genericResponse);
});

app.post('/api/auth/password-reset/confirm', (req, res) => {
  const { token, newPassword } = req.body || {};

  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({
      error: 'This reset link is invalid or has expired.',
    });
  }

  const tokenHash = hashResetToken(token);
  const entry = passwordResetTokens.get(tokenHash);

  if (!entry || entry.expiresAt <= Date.now()) {
    passwordResetTokens.delete(tokenHash);

    return res.status(400).json({
      error: 'This reset link is invalid or has expired.',
    });
  }

  try {
    setUserPassword(entry.userId, newPassword);
  } catch (err: any) {
    // Keep the token so the user can retry with a valid password.
    return res.status(400).json({
      error: err.message || 'Failed to reset password.',
    });
  }

  passwordResetTokens.delete(tokenHash);

  res.json({
    success: true,
    message:
      'Your password has been reset. You can now sign in with your new password.',
  });
});

app.get('/reset-password', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Reset Password - AI Document Helper</title>
    <style>
      body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0f172a; color:#f8fafc; font-family:-apple-system,Segoe UI,Roboto,sans-serif; padding:16px; box-sizing:border-box; }
      .card { width:100%; max-width:380px; background:#1e293b; border:1px solid #334155; border-radius:14px; padding:24px; box-sizing:border-box; }
      h1 { font-size:18px; margin:0 0 6px; }
      p { font-size:13px; color:#94a3b8; margin:0 0 16px; line-height:1.5; }
      label { display:block; font-size:12px; color:#cbd5e1; margin:12px 0 6px; }
      input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-size:14px; }
      button { margin-top:18px; width:100%; padding:11px; border:0; border-radius:10px; background:#2563eb; color:#fff; font-weight:600; font-size:14px; cursor:pointer; }
      button:disabled { opacity:.6; cursor:default; }
      .msg { margin-top:14px; font-size:13px; line-height:1.5; }
      .error { color:#fca5a5; }
      .ok { color:#86efac; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Set a new password</h1>
      <p>Choose a new password for your AI Document Helper account. All devices will be signed out.</p>
      <form id="reset-form" novalidate>
        <label for="pw">New password</label>
        <input id="pw" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required />
        <label for="pw2">Confirm new password</label>
        <input id="pw2" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required />
        <button id="submit" type="submit">Reset password</button>
      </form>
      <div id="msg" class="msg" role="status" aria-live="polite"></div>
    </main>
    <script>
      (function () {
        var minLength = ${PASSWORD_MIN_LENGTH};
        var match = /(?:^|[#&])token=([0-9a-f]{64})/.exec(window.location.hash || '');
        var token = match ? match[1] : '';
        var form = document.getElementById('reset-form');
        var msg = document.getElementById('msg');
        var btn = document.getElementById('submit');

        function show(text, ok) {
          msg.textContent = text;
          msg.className = 'msg ' + (ok ? 'ok' : 'error');
        }

        if (!token) {
          form.style.display = 'none';
          show('This reset link is invalid or incomplete. Please request a new one from the app.', false);
          return;
        }

        // Remove the token from the address bar and history.
        try { history.replaceState(null, '', window.location.pathname); } catch (e) {}

        form.addEventListener('submit', function (event) {
          event.preventDefault();
          var pw = document.getElementById('pw').value;
          var pw2 = document.getElementById('pw2').value;

          if (pw.length < minLength) {
            show('Password must be at least ' + minLength + ' characters long.', false);
            return;
          }

          if (pw !== pw2) {
            show('The passwords do not match.', false);
            return;
          }

          btn.disabled = true;
          show('Saving...', true);

          fetch('/api/auth/password-reset/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, newPassword: pw })
          })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
            .then(function (result) {
              if (result.ok) {
                form.style.display = 'none';
                show(result.data.message || 'Your password has been reset.', true);
              } else {
                btn.disabled = false;
                show(result.data.error || 'Failed to reset password.', false);
              }
            })
            .catch(function () {
              btn.disabled = false;
              show('Network error. Please check your connection and try again.', false);
            });
        });
      })();
    </script>
  </body>
</html>`);
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader =
    req.headers.authorization;

  const token =
    authHeader &&
    authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

  if (token) {
    invalidateSession(token);
  }

  res.json({
    status: 'ok',
  });
});

app.delete('/api/auth/account', (req, res) => {
  const { user } =
    getAuthContext(req);

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized.',
    });
  }

  deleteUserAccount(
    user.id
  );

  res.json({
    status: 'ok',
    message:
      'Account and all associated documents deleted.',
  });
});

// =============================================================
// USER USAGE & PRO PLAN ROUTES
// =============================================================

app.get('/api/user/usage', (req, res) => {
  const {
    user,
    identifier,
    isPro,
  } = getAuthContext(req);

  const usage =
    getDailyUsage(
      identifier,
      isPro
    );

  res.json({
    usage,
    plan: isPro ? 'pro' : 'free',
  });
});

app.post('/api/user/plan', (req, res) => {
  const { user } =
    getAuthContext(req);

  if (!user) {
    return res.status(401).json({
      error:
        'Please sign in to manage your plan.',
    });
  }

  const { plan } =
    req.body;

  if (
    plan !== 'free' &&
    plan !== 'pro'
  ) {
    return res.status(400).json({
      error:
        'Invalid plan selected.',
    });
  }

  if (
    plan === 'pro' &&
    !isUserAdmin(user)
  ) {
    return res.status(403).json({
      error:
        'Pro upgrades are currently available by invitation. Please contact the owner (aadeshv825@gmail.com).',
      invitationOnly: true,
    });
  }

  const updated =
    updateUserPlan(
      user.id,
      plan
    );

  const usage =
    getUserUsage(user);

  res.json({
    user: serializeUser(updated),
    usage,
  });
});

// =============================================================
// GOOGLE PLAY BILLING
// =============================================================

// Digital Asset Links
const DEFAULT_ASSET_LINKS = [
  {
    relation: [
      'delegate_permission/common.handle_all_urls',
    ],

    target: {
      namespace: 'android_app',

      package_name:
        'com.aidocumenthelper.app',

      sha256_cert_fingerprints: [
        'A3:6E:D2:90:95:41:40:7C:79:D9:03:F3:AB:54:6D:0D:C4:4A:99:9D:4B:84:DC:74:78:2C:D1:A3:85:96:48:F3',
        '14:6D:E9:7A:0F:7B:6C:54:9F:8B:2A:8B:E7:8F:6E:9A:B3:2F:1D:6A:4C:8B:7E:9A:1D:3B:5C:7E:9F:2A:4B:6C',
      ],
    },
  },
];

app.get(
  [
    '/.well-known/assetlinks.json',
    '/.well-known/assetlinks',
  ],
  (req, res) => {
    res.setHeader(
      'Content-Type',
      'application/json'
    );

    res.json(
      DEFAULT_ASSET_LINKS
    );
  }
);

// Google Play Billing configuration
app.get(
  '/api/billing/google-play/config',
  (req, res) => {
    res.json({
      enabled: true,
      platform: 'google_play',
      packageName:
        'com.aidocumenthelper.app',
      supportEmail:
        OWNER_EMAIL,

      products: [
        {
          sku:
            GOOGLE_PLAY_SKUS.MONTHLY,
          type: 'subs',
          title:
            'Document Helper Pro - Monthly',
          description:
            'Unlimited document scans, priority Gemini AI OCR, Hindi translation & PDF tools.',
          formattedPrice:
            '₹99/month',
          period:
            'monthly',
        },

        {
          sku:
            GOOGLE_PLAY_SKUS.ANNUAL,
          type: 'subs',
          title:
            'Document Helper Pro - Annual',
          description:
            'Unlimited document scans, priority Gemini AI OCR, Hindi translation & PDF tools. Save 41%.',
          formattedPrice:
            '₹699/year',
          period:
            'annual',
        },
      ],
    });
  }
);

// =============================================================
// GOOGLE PLAY API CLIENT
// =============================================================

// IMPORTANT:
// Cloud Run should run using the Google Cloud service account that
// has the required Google Play Console permissions.
// This uses Application Default Credentials (ADC).
let googlePlayPublisher:
  ReturnType<
    typeof google.androidpublisher
  > | null = null;

function getGooglePlayPublisher() {
  if (!googlePlayPublisher) {
    const auth =
      new google.auth.GoogleAuth({
        scopes: [
          'https://www.googleapis.com/auth/androidpublisher',
        ],
      });

    googlePlayPublisher =
      google.androidpublisher({
        version: 'v3',
        auth,
      });
  }

  return googlePlayPublisher;
}

function getGooglePlaySubscriptionExpiry(
  subscription: any
): number | null {
  const expiryTime =
    subscription?.lineItems?.[0]
      ?.expiryTime;

  if (
    !expiryTime ||
    typeof expiryTime !== 'string'
  ) {
    return null;
  }

  const expiryMs =
    Date.parse(expiryTime);

  return Number.isFinite(
    expiryMs
  )
    ? expiryMs
    : null;
}

function isGooglePlaySubscriptionActive(
  subscription: any,
  now = Date.now()
): boolean {
  const state =
    subscription?.subscriptionState;

  const expiryMs =
    getGooglePlaySubscriptionExpiry(
      subscription
    );

  if (
    !expiryMs ||
    expiryMs <= now
  ) {
    return false;
  }

  return (
    state ===
      'SUBSCRIPTION_STATE_ACTIVE' ||
    state ===
      'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
  );
}

const GOOGLE_PLAY_PACKAGE_NAME =
  'com.aidocumenthelper.app';

// The Android app passes the signed-in user id as the obfuscated
// account id when launching the billing flow. If Google reports one,
// it must match the account claiming the purchase.
function isGooglePlayAccountMatch(
  subscription: any,
  user: StoredUser
): boolean {
  const obfuscatedAccountId =
    subscription?.externalAccountIdentifiers
      ?.obfuscatedExternalAccountId;

  if (!obfuscatedAccountId) {
    return true;
  }

  return obfuscatedAccountId === user.id;
}

// =============================================================
// GOOGLE PLAY PURCHASE VERIFICATION
// =============================================================

app.post(
  '/api/billing/google-play/verify-purchase',
  async (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error:
          'Please sign in or register before completing your Google Play purchase so Pro can be linked to your account.',
      });
    }

    const {
      purchaseToken,
      sku,
      orderId,
      packageName,
    } = req.body;

    const expectedPackageName =
      'com.aidocumenthelper.app';

    if (
      !purchaseToken ||
      typeof purchaseToken !== 'string' ||
      purchaseToken.trim().length === 0 ||
      purchaseToken.length > 4096
    ) {
      return res.status(400).json({
        error:
          'Valid Google Play purchase token is required.',
      });
    }

    if (
      !sku ||
      typeof sku !== 'string' ||
      !isValidGooglePlaySku(sku)
    ) {
      return res.status(400).json({
        error:
          `Invalid product SKU. Must be one of: ${Object.values(
            GOOGLE_PLAY_SKUS
          ).join(', ')}.`,
      });
    }

    if (
      packageName &&
      packageName !==
        expectedPackageName
    ) {
      return res.status(400).json({
        error:
          'Invalid Android package name.',
      });
    }

    const token =
      purchaseToken.trim();

    // Prevent token replay across accounts
    const existingRecord =
      findGooglePlayPurchaseByToken(
        token
      );

    if (
      existingRecord &&
      existingRecord.userId !==
        user.id
    ) {
      return res.status(409).json({
        error:
          'This Google Play purchase token has already been associated with another user account.',
      });
    }

    try {
      const publisher =
        getGooglePlayPublisher();

      // Read the real subscription state from Google Play.
      const googleResponse =
        await publisher.purchases.subscriptionsv2.get(
          {
            packageName:
              expectedPackageName,
            token,
          }
        );

      const subscription =
        googleResponse.data;

      const lineItem =
        subscription
          .lineItems?.[0];

      const verifiedSku =
        lineItem?.productId ||
        '';

      const expiryTime =
        getGooglePlaySubscriptionExpiry(
          subscription
        );

      const now =
        Date.now();

      if (
        !isGooglePlayAccountMatch(
          subscription,
          user
        )
      ) {
        return res.status(409).json({
          error:
            'This Google Play purchase belongs to a different app account.',
        });
      }

      // Never trust SKU supplied by client alone.
      if (
        verifiedSku !== sku
      ) {
        return res.status(400).json({
          error:
            'The Google Play purchase product does not match the selected Pro plan.',
        });
      }

      // Only currently active / grace-period subscriptions
      // with a future expiry are accepted.
      if (
        !isGooglePlaySubscriptionActive(
          subscription,
          now
        )
      ) {
        return res.status(400).json({
          error:
            'This Google Play subscription is not currently active.',

          subscriptionState:
            subscription.subscriptionState ||
            'UNKNOWN',

          expiryTime:
            expiryTime
              ? new Date(
                  expiryTime
                ).toISOString()
              : null,
        });
      }

      if (!expiryTime) {
        return res.status(400).json({
          error:
            'Google Play did not return a valid subscription expiry time.',
        });
      }

      const verifiedOrderId =
        lineItem?.latestSuccessfulOrderId ||
        (typeof orderId === 'string' &&
        orderId.length <= 100
          ? orderId
          : '') ||
        `GPA.${Date.now()}-${crypto
          .randomBytes(3)
          .toString('hex')
          .toUpperCase()}`;

      // Acknowledge the subscription only after Google Play verification.
      if (
        subscription.acknowledgementState ===
        'ACKNOWLEDGEMENT_STATE_PENDING'
      ) {
        await publisher.purchases.subscriptions.acknowledge({
          packageName: expectedPackageName,
          subscriptionId: verifiedSku,
          token,
          requestBody: {},
        });
      }

      const purchaseRecord:
        GooglePlayPurchaseRecord =
        {
          id: `gp_${Date.now()}_${crypto
            .randomBytes(3)
            .toString('hex')}`,

          userId:
            user.id,

          purchaseToken:
            token,

          sku:
            verifiedSku,

          orderId:
            verifiedOrderId,

          packageName:
            expectedPackageName,

          purchaseTime:
            subscription.startTime
              ? Date.parse(
                  subscription.startTime
                )
              : Date.now(),

          expiryTime:
            expiryTime,

          state:
            'VERIFIED',

          verifiedAt:
            Date.now(),
        };

      // Record first: this refuses tokens already linked to another account.
      recordGooglePlayPurchase(
        purchaseRecord
      );

      // Activate Pro only after successful verification and acknowledgement.
      const updated =
        updateUserPlan(
          user.id,
          'pro',
          expiryTime
        );

      const usage =
        getUserUsage(user);

      console.log(
        `[Google Play Billing] Verified with Google Play API for ${user.email} (${user.id}), SKU: ${verifiedSku}, Order: ${verifiedOrderId}, Expiry: ${new Date(
          expiryTime
        ).toISOString()}`
      );

      return res.json({
        success: true,

        message:
          'Google Play subscription verified successfully! Pro membership is now active on your account.',

        user:
          serializeUser(updated),

        usage,

        purchase:
          purchaseRecord,

        verification: {
          source:
            'google_play_developer_api',

          subscriptionState:
            subscription.subscriptionState ||
            'UNKNOWN',

          acknowledgementState:
            subscription.acknowledgementState ||
            'UNKNOWN',

          expiryTime:
            new Date(
              expiryTime
            ).toISOString(),
        },
      });
    } catch (err: any) {
      const status =
        err?.response?.status ||
        err?.code;

      console.error(
        '[Google Play Billing] Verification failed:',
        err?.response?.data ||
          err?.message ||
          err
      );

      if (
        status === 401 ||
        status === 403
      ) {
        return res.status(503).json({
          error:
            'Google Play verification is not authorized yet. Please verify the backend Google Play service-account configuration.',
        });
      }

      if (
        status === 404
      ) {
        return res.status(400).json({
          error:
            'Google Play could not find this subscription purchase.',
        });
      }

      return res.status(502).json({
        error:
          'Google Play purchase verification failed. Please try again.',
      });
    }
  }
);

// =============================================================
// Verifies a subscription token with Google Play for a user and,
// if active, records/acknowledges it. Never throws.
async function verifyGooglePlaySubscriptionForUser(
  token: string,
  user: StoredUser
): Promise<
  | { status: 'active'; record: GooglePlayPurchaseRecord }
  | { status: 'inactive' }
  | { status: 'error' }
> {
  try {
    const publisher =
      getGooglePlayPublisher();

    const googleResponse =
      await publisher.purchases.subscriptionsv2.get(
        {
          packageName:
            GOOGLE_PLAY_PACKAGE_NAME,
          token,
        }
      );

    const subscription =
      googleResponse.data;

    if (
      !isGooglePlaySubscriptionActive(
        subscription
      ) ||
      !isGooglePlayAccountMatch(
        subscription,
        user
      )
    ) {
      return { status: 'inactive' };
    }

    const lineItem =
      subscription
        .lineItems?.[0];

    const verifiedSku =
      lineItem?.productId ||
      '';

    if (
      !verifiedSku ||
      !isValidGooglePlaySku(
        verifiedSku
      )
    ) {
      return { status: 'inactive' };
    }

    const expiryTime =
      getGooglePlaySubscriptionExpiry(
        subscription
      );

    if (!expiryTime) {
      return { status: 'inactive' };
    }

    // Acknowledge restored subscription after Google Play verification.
    if (
      subscription.acknowledgementState ===
      'ACKNOWLEDGEMENT_STATE_PENDING'
    ) {
      await publisher.purchases.subscriptions.acknowledge({
        packageName: GOOGLE_PLAY_PACKAGE_NAME,
        subscriptionId: verifiedSku,
        token,
        requestBody: {},
      });
    }

    const existingRecord =
      findGooglePlayPurchaseByToken(
        token
      );

    const verifiedOrderId =
      lineItem
        ?.latestSuccessfulOrderId ||
      existingRecord?.orderId ||
      `GPA.${Date.now()}-${crypto
        .randomBytes(3)
        .toString('hex')
        .toUpperCase()}`;

    const purchaseRecord:
      GooglePlayPurchaseRecord =
      {
        id:
          existingRecord?.id ||
          `gp_${Date.now()}_${crypto
            .randomBytes(3)
            .toString('hex')}`,

        userId:
          user.id,

        purchaseToken:
          token,

        sku:
          verifiedSku,

        orderId:
          verifiedOrderId,

        packageName:
          GOOGLE_PLAY_PACKAGE_NAME,

        purchaseTime:
          subscription.startTime
            ? Date.parse(
                subscription.startTime
              )
            : Date.now(),

        expiryTime:
          expiryTime,

        state:
          'VERIFIED',

        verifiedAt:
          Date.now(),
      };

    recordGooglePlayPurchase(
      purchaseRecord
    );

    return {
      status: 'active',
      record: purchaseRecord,
    };
  } catch (verifyErr: any) {
    const status =
      verifyErr?.response?.status ||
      verifyErr?.code;

    console.error(
      '[Google Play Billing] Restore token verification failed:',
      verifyErr?.response?.data ||
        verifyErr?.message ||
        verifyErr
    );

    // 400/404/410 mean Google does not recognise the token.
    if (
      status === 400 ||
      status === 404 ||
      status === 410
    ) {
      return { status: 'inactive' };
    }

    return { status: 'error' };
  }
}

// =============================================================
// RESTORE GOOGLE PLAY PURCHASES
// =============================================================

app.post(
  '/api/billing/google-play/restore-purchases',
  async (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error:
          'Please sign in to restore your purchases.',
      });
    }

    const {
      purchaseTokens,
    } = req.body;

    const userPurchases =
      getUserGooglePlayPurchases(
        user.id
      );

    const now =
      Date.now();

    let activePurchase:
      GooglePlayPurchaseRecord | undefined;

    // Re-check existing server records with Google Play so that
    // refunded / revoked / cancelled subscriptions are not restored
    // and renewed subscriptions are picked up.
    const isLocallyActive = (
      p: GooglePlayPurchaseRecord
    ) =>
      p.state === 'VERIFIED' &&
      (
        !p.expiryTime ||
        p.expiryTime > now
      );

    const localCandidates =
      [...userPurchases]
        .sort(
          (a, b) =>
            (b.expiryTime || 0) -
            (a.expiryTime || 0)
        )
        .slice(0, 10);

    for (const record of localCandidates) {
      const result =
        await verifyGooglePlaySubscriptionForUser(
          record.purchaseToken,
          user
        );

      if (result.status === 'active') {
        activePurchase = result.record;
        break;
      }

      if (result.status === 'inactive') {
        if (record.state !== 'VERIFIED') {
          continue;
        }

        try {
          recordGooglePlayPurchase({
            ...record,
            state: 'EXPIRED',
            verifiedAt: Date.now(),
          });
        } catch (markErr) {
          console.error(
            '[Google Play Billing] Failed to mark purchase inactive:',
            markErr
          );
        }

        continue;
      }

      // Google Play API temporarily unavailable: keep the previously
      // verified, unexpired server record instead of removing access.
      if (isLocallyActive(record)) {
        activePurchase = record;
        break;
      }
    }

    // Then verify tokens submitted by the device directly with Google.
    if (
      !activePurchase &&
      Array.isArray(
        purchaseTokens
      )
    ) {
      for (
        const rawToken of purchaseTokens.slice(0, 20)
      ) {
        if (
          typeof rawToken !==
            'string' ||
          rawToken.length > 4096
        ) {
          continue;
        }

        const token =
          rawToken.trim();

        if (!token) {
          continue;
        }

        const existingRecord =
          findGooglePlayPurchaseByToken(
            token
          );

        if (
          existingRecord &&
          existingRecord.userId !==
            user.id
        ) {
          continue;
        }

        const result =
          await verifyGooglePlaySubscriptionForUser(
            token,
            user
          );

        if (result.status === 'active') {
          activePurchase = result.record;
          break;
        }
      }
    }

    if (activePurchase) {
      const restoredExpiry =
        activePurchase.expiryTime;

      const updated =
        updateUserPlan(
          user.id,
          'pro',
          restoredExpiry
        );

      const usage =
        getUserUsage(user);

      return res.json({
        success: true,
        restored: true,

        message:
          'Active Google Play Pro subscription restored successfully!',

        user:
          serializeUser(updated),

        usage,

        purchase:
          activePurchase,
      });
    }

    return res.json({
      success: true,
      restored: false,

      message:
        'No active Google Play Pro subscription found for this account.',
    });
  }
);

// =============================================================
// GOOGLE PLAY PURCHASE HISTORY
// =============================================================

app.get(
  '/api/billing/google-play/purchases',
  (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error:
          'Authentication required.',
      });
    }

    const list =
      getUserGooglePlayPurchases(
        user.id
      );

    res.json({
      purchases: list,
    });
  }
);

// =============================================================
// OWNER & ADMIN USER MANAGEMENT
// =============================================================

app.get(
  '/api/admin/users',
  (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error:
          'Authentication required.',
      });
    }

    if (!isUserAdmin(user)) {
      return res.status(403).json({
        error:
          'Access denied. Only the app owner/admin can access user management.',
      });
    }

    const allUsers =
      getAllUsers();

    const usersWithUsage =
      allUsers.map((u) => {
        const proActive = isProActive(u);

        return {
          ...u,
          plan: proActive ? 'pro' : 'free',
          proUntil: proActive ? u.proUntil : undefined,
          usage: getDailyUsage(`user:${u.id}`, proActive),
        };
      });

    res.json({
      users:
        usersWithUsage,

      ownerEmail:
        OWNER_EMAIL,
    });
  }
);

app.post(
  '/api/admin/users/:userId/plan',
  (req, res) => {
    const { user: caller } =
      getAuthContext(req);

    if (!caller) {
      return res.status(401).json({
        error:
          'Authentication required.',
      });
    }

    if (!isUserAdmin(caller)) {
      return res.status(403).json({
        error:
          'Access denied. Only the app owner/admin can modify user plans.',
      });
    }

    const { userId } =
      req.params;

    const { plan } =
      req.body;

    if (
      plan !== 'free' &&
      plan !== 'pro'
    ) {
      return res.status(400).json({
        error:
          'Invalid plan. Must be "free" or "pro".',
      });
    }

    try {
      const updated =
        updateUserPlan(
          userId,
          plan
        );

      const usage =
        getUserUsage(updated);

      res.json({
        success: true,

        message:
          plan === 'pro'
            ? `Pro access granted to ${updated.name} (${updated.email}). Unlimited AI limits active.`
            : `Pro access removed for ${updated.name} (${updated.email}). Free limits restored.`,

        user:
          serializeUser(
            updated
          ),

        usage,
      });
    } catch (err: any) {
      res.status(404).json({
        error:
          err.message ||
          'User not found.',
      });
    }
  }
);

// =============================================================
// CLOUD DOCUMENT STORAGE & CROSS-DEVICE SYNC
// =============================================================

app.get('/api/documents', (req, res) => {
  const { user } =
    getAuthContext(req);

  if (!user) {
    return res.json({
      documents: [],
    });
  }

  const docs =
    getUserDocuments(
      user.id
    );

  res.json({
    documents: docs,
  });
});

app.post('/api/documents', (req, res) => {
  const { user } =
    getAuthContext(req);

  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized.',
    });
  }

  try {
    const {
      id,
      title,
      type,
      snippet,
      fullContent,
      isFavorite,
      category,
      timestamp,
    } = req.body;

    if (!fullContent) {
      return res.status(400).json({
        error:
          'Document content is required.',
      });
    }

    const doc =
      saveUserDocument(
        user.id,
        {
          id,
          title,
          type,
          snippet,
          fullContent,
          isFavorite,
          category,
          timestamp,
        }
      );

    res.json({
      document: doc,
    });
  } catch (err: any) {
    res.status(500).json({
      error:
        err.message ||
        'Failed to save document.',
    });
  }
});

app.put(
  '/api/documents/:id',
  (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized.',
      });
    }

    try {
      const {
        title,
        isFavorite,
        category,
      } = req.body;

      const doc =
        updateUserDocument(
          user.id,
          req.params.id,
          {
            title,
            isFavorite,
            category,
          }
        );

      res.json({
        document: doc,
      });
    } catch (err: any) {
      res.status(404).json({
        error:
          err.message ||
          'Document not found.',
      });
    }
  }
);

app.delete(
  '/api/documents/:id',
  (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized.',
      });
    }

    deleteUserDocument(
      user.id,
      req.params.id
    );

    res.json({
      status: 'ok',
    });
  }
);

app.delete(
  '/api/documents',
  (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized.',
      });
    }

    clearUserDocuments(
      user.id
    );

    res.json({
      status: 'ok',
    });
  }
);

app.post(
  '/api/documents/sync',
  (req, res) => {
    const { user } =
      getAuthContext(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized.',
      });
    }

    const {
      documents: clientDocs,
    } = req.body;

    if (
      !Array.isArray(clientDocs)
    ) {
      return res.status(400).json({
        error:
          'Invalid document payload.',
      });
    }

    const synced =
      syncUserDocuments(
        user.id,
        clientDocs
      );

    res.json({
      documents: synced,
    });
  }
);

// =============================================================
// ANDROID PROJECT DOWNLOAD (REMOVED)
// =============================================================
// The public Android project archive endpoint was removed because the
// archive contained signing material. Android releases are built from
// source by the GitHub Actions release workflow.

// Unknown API routes must return JSON instead of falling through to
// the single-page app's index.html.
app.all('/api/*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found.',
  });
});

// Body parser and unexpected route errors are returned as JSON so the
// app can show a meaningful message.
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (res.headersSent) {
      return next(err);
    }

    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error:
          'The uploaded file or text is too large. Please use a smaller file.',
      });
    }

    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'Invalid request body.',
      });
    }

    console.error('[Server] Unhandled request error:', err?.message || err);

    res.status(500).json({
      error: 'Something went wrong. Please try again.',
    });
  }
);

// =============================================================
// VITE SERVER
// =============================================================

async function startServer() {
  // Storage must be ready before any request is served.
  await initStore();

  if (
    process.env.NODE_ENV !==
    'production'
  ) {
    const vite =
      await createViteServer({
        server: {
          middlewareMode: true,
        },

        appType: 'spa',
      });

    app.use(
      vite.middlewares
    );
  } else {
    const distPath =
      path.join(
        process.cwd(),
        'dist'
      );

    app.use(
      express.static(
        distPath
      )
    );

    app.get(
      '*',
      (req, res) => {
        res.sendFile(
          path.join(
            distPath,
            'index.html'
          )
        );
      }
    );
  }

  const server = app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `Document Helper server running at http://0.0.0.0:${PORT}`
      );
    }
  );

  // Cloud Run sends SIGTERM before stopping an instance. Finish
  // pending database writes before exiting.
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;

    shuttingDown = true;

    console.log(
      `[Server] Received ${signal}; flushing storage and shutting down.`
    );

    server.close();

    flushStore()
      .catch((err) => {
        console.error(
          '[Server] Failed to flush storage during shutdown:',
          err
        );
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error(
    '[Server] Failed to start:',
    err
  );

  process.exit(1);
});
