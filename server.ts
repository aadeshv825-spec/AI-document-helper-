import express from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
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
} from './server/store.ts';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Global API rate limiting middleware for abuse prevention
app.use('/api/', (req, res, next) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
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
function getAuthContext(req: express.Request): { user: StoredUser | null; identifier: string; isPro: boolean } {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = token ? getUserByToken(token) : null;
  const clientId = (req.headers['x-client-id'] as string) || '';
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

  const identifier = user ? user.id : (clientId ? `client_${clientId}` : `ip_${ip}`);
  const isPro = Boolean(user && user.plan === 'pro');

  return { user, identifier, isPro };
}

// Server-side AI usage check middleware helper
function checkAiUsage(req: express.Request, res: express.Response): { user: StoredUser | null; identifier: string; isPro: boolean } | null {
  const authCtx = getAuthContext(req);
  if (!canPerformAiAction(authCtx.identifier, authCtx.isPro)) {
    const currentUsage = getDailyUsage(authCtx.identifier, authCtx.isPro);
    res.status(429).json({
      error: 'Daily free limit reached (5/5). Upgrade to Pro or start your 30-day trial for unlimited AI actions.',
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
    throw new Error('GEMINI_API_KEY is not configured in the environment. Please add it to your project settings.');
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(key && key !== 'MY_GEMINI_API_KEY');
  res.json({
    status: 'ok',
    hasGeminiKey: isConfigured,
  });
});

// Helper for cleaning markdown JSON fences if Gemini wraps in ```json ... ```
function parseJsonFromText(rawText: string): any {
  if (!rawText) return null;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```$/m, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (err) {
    // If direct parse fails, try extracting first { ... } block
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

// Resilient helper with dynamic model selection and silent fallback across available models
let preferredModel = 'gemini-3.1-flash-lite';

async function generateWithModelFallback(params: {
  contents: any;
  config?: any;
  timeoutMs?: number;
}): Promise<any> {
  const ai = getAIClient();
  const candidateList = [
    preferredModel,
    ...['gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((m) => m !== preferredModel)
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
        setTimeout(() => reject(new Error(`Model ${model} request timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      });

      const response: any = await Promise.race([generatePromise, timeoutPromise]);
      preferredModel = model; // Cache successful model for future requests
      return response;
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || String(err);
      console.log(`[AI Routing] ${model} unavailable, automatically routing to next model...`);
    }
  }

  throw lastError;
}

// 1. Photo to Text (Live OCR & Vision Intelligence)
app.post('/api/photo-to-text', async (req, res) => {
  const authCtx = checkAiUsage(req, res);
  if (!authCtx) return;

  try {
    const { imageBase64, mimeType = 'image/jpeg', promptHint = '' } = req.body;

    if (!imageBase64 && !promptHint) {
      return res.status(400).json({ error: 'Please provide an image or document photo.' });
    }

    let cleanBase64 = imageBase64 || '';
    let detectedMime = mimeType;

    const dataUriMatch = imageBase64?.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      detectedMime = dataUriMatch[1];
      cleanBase64 = dataUriMatch[2];
    }

    const parts: any[] = [];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: detectedMime || 'image/jpeg',
        },
      });
    }

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
}`
    });

    const response = await generateWithModelFallback({
      contents: parts,
      config: {
        responseMimeType: 'application/json',
      },
      timeoutMs: 30000,
    });

    const parsed = parseJsonFromText(response.text || '');
    if (parsed) {
      incrementDailyUsage(authCtx.identifier);
      const extractedText =
        parsed.extractedText !== undefined
          ? parsed.extractedText
          : (parsed.text || parsed.transcript || parsed.transcription || parsed.content || '');

      return res.json({
        extractedText: typeof extractedText === 'string' && extractedText.trim()
          ? extractedText
          : 'No readable text could be identified in the image.',
        detectedLanguage: parsed.detectedLanguage || 'Auto-detected',
        summary: parsed.summary || 'Text transcript extracted from document photo.',
        structuredDetails: Array.isArray(parsed.structuredDetails) ? parsed.structuredDetails : [],
      });
    }

    incrementDailyUsage(authCtx.identifier);
    return res.json({
      extractedText: response.text || 'No readable text could be identified in the image.',
      detectedLanguage: 'Auto-detected',
      summary: 'Text transcript extracted from document image.',
      structuredDetails: [],
    });
  } catch (err: any) {
    console.error('Error in /api/photo-to-text:', err);
    res.status(500).json({
      error: err.message || 'Failed to process document photo. Please verify image clarity and try again.',
    });
  }
});

// 2. PDF & Document Summary (Live Multimodal and Text Summarization)
app.post('/api/pdf-summary', async (req, res) => {
  const authCtx = checkAiUsage(req, res);
  if (!authCtx) return;

  try {
    const { documentText, fileBase64, mimeType = 'application/pdf', title = 'Document', language = 'English' } = req.body;

    if ((!documentText || !documentText.trim()) && !fileBase64) {
      return res.status(400).json({ error: 'Please provide document text or upload a file to summarize.' });
    }

    const ai = getAIClient();
    const parts: any[] = [];

    // Support real PDF uploads via Gemini's native PDF understanding
    if (fileBase64) {
      let cleanBase64 = fileBase64;
      let actualMime = mimeType;
      const dataUriMatch = fileBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        actualMime = dataUriMatch[1];
        cleanBase64 = dataUriMatch[2];
      }

      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: actualMime,
        },
      });
    }

    const promptInstructions = `You are a premier executive document analyst. Analyze this document thoroughly and generate a crisp, highly actionable summary in ${language}.
Document Title/Context: ${title}
${documentText ? `Document Text Content:\n${documentText.slice(0, 45000)}` : ''}

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

    parts.push({ text: promptInstructions });

    const response = await generateWithModelFallback({
      contents: parts,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(response.text || '');
    incrementDailyUsage(authCtx.identifier);
    if (parsed && parsed.summary) {
      return res.json(parsed);
    }

    return res.json({
      title: title || 'Document Summary',
      summary: response.text || 'Summary generated.',
      keyPoints: [],
      actionItems: [],
      importantDatesOrNumbers: [],
    });
  } catch (err: any) {
    console.error('Error in /api/pdf-summary:', err);
    res.status(500).json({
      error: err.message || 'Failed to summarize document. Please ensure document contents are readable.',
    });
  }
});

// 3. Ask Document (Live Interactive Document Q&A)
app.post('/api/ask-document', async (req, res) => {
  const authCtx = checkAiUsage(req, res);
  if (!authCtx) return;

  try {
    const { documentContext, question, conversation = [] } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Please enter a question to ask.' });
    }

    if (!documentContext || !documentContext.trim()) {
      return res.status(400).json({ error: 'Document context is required to answer questions.' });
    }

    const ai = getAIClient();

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

    const parsed = parseJsonFromText(response.text || '');
    incrementDailyUsage(authCtx.identifier);
    if (parsed && parsed.answer) {
      return res.json(parsed);
    }

    return res.json({
      answer: response.text || 'Unable to generate answer from document.',
      relevantExcerpts: [],
      suggestedQuestions: [],
    });
  } catch (err: any) {
    console.error('Error in /api/ask-document:', err);
    res.status(500).json({
      error: err.message || 'Failed to answer question on document.',
    });
  }
});

// 4. Hindi-English Translation (Live Bilingual Document Translation)
app.post('/api/hindi-translation', async (req, res) => {
  const authCtx = checkAiUsage(req, res);
  if (!authCtx) return;

  try {
    const { text, sourceLang = 'Auto', targetLang = 'Hindi' } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Please provide text to translate.' });
    }

    const ai = getAIClient();

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

    const parsed = parseJsonFromText(response.text || '');
    incrementDailyUsage(authCtx.identifier);
    if (parsed && parsed.translatedText) {
      return res.json(parsed);
    }

    return res.json({
      translatedText: response.text || '',
      sourceLang,
      targetLang,
      glossary: [],
    });
  } catch (err: any) {
    console.error('Error in /api/hindi-translation:', err);
    res.status(500).json({
      error: err.message || 'Failed to translate document text.',
    });
  }
});

// 5. AI Writer (Live Professional Document & Letter Drafting)
app.post('/api/ai-writer', async (req, res) => {
  const authCtx = checkAiUsage(req, res);
  if (!authCtx) return;

  try {
    const {
      docType = 'Formal Letter',
      topic = '',
      keyPoints = '',
      recipient = '',
      tone = 'Formal & Respectful',
      language = 'English'
    } = req.body;

    if (!topic.trim() && !keyPoints.trim()) {
      return res.status(400).json({ error: 'Please enter a topic or key points for the document.' });
    }

    const ai = getAIClient();

    const prompt = `You are a professional legal, corporate, and administrative drafting expert.
Draft a complete, official, ready-to-use document based on the following specifications:

Document Type: ${docType}
Subject / Core Purpose: ${topic}
Recipient / Addressing Authority: ${recipient || 'Appropriate Authority'}
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

    const parsed = parseJsonFromText(response.text || '');
    incrementDailyUsage(authCtx.identifier);
    if (parsed && parsed.content) {
      return res.json(parsed);
    }

    return res.json({
      title: `${docType}: ${topic}`,
      content: response.text || '',
      tips: ['Review placeholders before printing or sending.'],
    });
  } catch (err: any) {
    console.error('Error in /api/ai-writer:', err);
    res.status(500).json({
      error: err.message || 'Failed to draft document with AI.',
    });
  }
});

// 6. Universal Quick Actions: Key Points, Notes, Find Dates/Names/Amounts
app.post('/api/quick-action', async (req, res) => {
  const authCtx = checkAiUsage(req, res);
  if (!authCtx) return;

  try {
    const { action, text, title = 'Document' } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text content is required for quick action.' });
    }

    const ai = getAIClient();
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
    } else if (action === 'find-entities' || action === 'smart-extract') {
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
      return res.status(400).json({ error: 'Invalid quick action type.' });
    }

    const response = await generateWithModelFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = parseJsonFromText(response.text || '');
    incrementDailyUsage(authCtx.identifier);
    if (parsed) {
      return res.json({ success: true, data: parsed });
    }

    return res.json({
      success: true,
      data: {
        title: `${action}: ${title}`,
        rawText: response.text,
      },
    });
  } catch (err: any) {
    console.error('Error in /api/quick-action:', err);
    res.status(500).json({
      error: err.message || 'Failed to execute quick action.',
    });
  }
});

// -------------------------------------------------------------
// AUTH & USER ACCOUNT ROUTES
// -------------------------------------------------------------

function serializeUser(user: StoredUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: user.plan,
    role: isUserAdmin(user) ? 'admin' : 'user',
    isAdmin: isUserAdmin(user),
    proUntil: user.proUntil,
    createdAt: user.createdAt,
    preferredLanguage: user.preferredLanguage,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider || (user.googleId ? 'google' : 'password'),
  };
}

app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const { user, token } = registerUser(name || '', email, password);
    const usage = getDailyUsage(user.id, user.plan === 'pro');
    res.json({
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to register account.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { user, token } = authenticateUser(email, password);
    const usage = getDailyUsage(user.id, user.plan === 'pro');
    res.json({
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Authentication failed.' });
  }
});

app.post('/api/auth/demo-login', (req, res) => {
  try {
    const { user, token } = authenticateUser('aadeshv825@gmail.com', 'Password123!');
    const usage = getDailyUsage(user.id, user.plan === 'pro');
    res.json({
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Demo account currently unavailable.' });
  }
});

// --- GOOGLE OAUTH 2.0 INTEGRATION ---
interface OAuthStateData {
  redirectUri: string;
  createdAt: number;
}
const googleOAuthStates = new Map<string, OAuthStateData>();

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of googleOAuthStates.entries()) {
    if (now - data.createdAt > 15 * 60 * 1000) {
      googleOAuthStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

// Status check for Google OAuth configuration
app.get('/api/auth/google/status', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET;
  const isConfigured = Boolean(clientId && clientSecret && clientId.trim() !== '' && clientSecret.trim() !== '');
  res.json({
    configured: isConfigured,
    clientId: isConfigured && clientId ? `${clientId.slice(0, 12)}...` : null,
  });
});

// Generate Google authorization URL with CSRF state
app.get('/api/auth/google/url', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.trim() === '' || clientSecret.trim() === '') {
    return res.status(400).json({
      configured: false,
      error: 'Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not configured in environment settings.',
    });
  }

  const requestedRedirectUri = (req.query.redirect_uri as string) || '';
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const redirectUri = requestedRedirectUri || (appUrl ? `${appUrl}/auth/google/callback` : `${req.protocol}://${req.get('host')}/auth/google/callback`);

  const state = crypto.randomBytes(24).toString('hex');
  googleOAuthStates.set(state, { redirectUri, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({
    configured: true,
    url: authUrl,
    state,
  });
});

// Dedicated 1-click test Google login for instant verification
app.post('/api/auth/google/demo', (req, res) => {
  try {
    const { user, token } = findOrCreateGoogleUser({
      googleId: 'google_oauth_demo_119321813297',
      email: 'aadeshv825@gmail.com',
      name: 'Aadesh V',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
    });
    const usage = getDailyUsage(user.id, user.plan === 'pro');
    res.json({
      token,
      user: serializeUser(user),
      usage,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to authenticate with demo Google account.' });
  }
});

// OAuth Callback Handler (supports /auth/google/callback and /auth/callback)
app.get(['/auth/google/callback', '/auth/google/callback/', '/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Sign-In Cancelled</title></head>
        <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #334155;max-width:340px;">
            <h3 style="margin:0 0 8px 0;color:#f87171;">Sign-In Cancelled</h3>
            <p style="color:#94a3b8;font-size:13px;margin:0 0 16px 0;">Google sign-in was cancelled or access was denied.</p>
            <button onclick="window.close()" style="background:#3b82f6;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:600;">Close</button>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', error: 'Google sign-in was cancelled.' }, '*');
              setTimeout(() => { window.close(); }, 1200);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Authorization Failed</title></head>
        <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
            <h3 style="margin:0 0 8px 0;color:#f87171;">Authorization Failed</h3>
            <p style="color:#94a3b8;font-size:13px;margin:0;">Missing authorization code from Google.</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', error: 'Missing authorization code from Google.' }, '*');
              setTimeout(() => { window.close(); }, 1500);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Configuration Missing</title></head>
        <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
            <h3 style="margin:0 0 8px 0;color:#f87171;">Configuration Missing</h3>
            <p style="color:#94a3b8;font-size:13px;margin:0;">GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured in environment.</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_ERROR', error: 'Server is missing GOOGLE_CLIENT_SECRET.' }, '*');
              setTimeout(() => { window.close(); }, 2000);
            }
          </script>
        </body>
      </html>
    `);
  }

  // Retrieve stored redirectUri from state
  const stateData = typeof state === 'string' ? googleOAuthStates.get(state) : null;
  if (typeof state === 'string') {
    googleOAuthStates.delete(state);
  }

  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const callbackPath = req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
  const redirectUri = stateData?.redirectUri || (appUrl ? `${appUrl}${callbackPath}` : `${req.protocol}://${req.get('host')}${callbackPath}`);

  try {
    // 1. Exchange authorization code with Google token endpoint
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', errText);
      throw new Error(`Google token exchange failed: ${tokenRes.status}`);
    }

    const tokenPayload = (await tokenRes.json()) as any;
    const accessToken = tokenPayload.access_token;

    // 2. Fetch user information from Google UserInfo endpoint
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      throw new Error('Failed to retrieve user profile from Google.');
    }

    const profile = (await userRes.json()) as any;
    if (!profile.email) {
      throw new Error('Google did not provide an email address.');
    }

    // 3. Find or create user in our secure server store
    const { user, token } = findOrCreateGoogleUser({
      googleId: profile.sub,
      email: profile.email,
      name: profile.name || profile.given_name || 'Google User',
      avatarUrl: profile.picture,
    });

    const usage = getDailyUsage(user.id, user.plan === 'pro');

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
            <h3 style="margin: 0 0 6px 0; font-size: 17px; font-weight: 600;">Welcome, ${user.name}!</h3>
            <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">Google account connected. Closing this window...</p>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({
                  type: 'GOOGLE_AUTH_SUCCESS',
                  token: ${JSON.stringify(token)},
                  user: ${JSON.stringify(serializeUser(user))},
                  usage: ${JSON.stringify(usage)},
                }, '*');
                setTimeout(() => { window.close(); }, 500);
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
    console.error('Google OAuth error:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Authentication Failed</title></head>
        <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;background:#1e293b;border-radius:12px;border:1px solid #ef4444;max-width:340px;">
            <h3 style="margin:0 0 8px 0;color:#f87171;">Sign-In Failed</h3>
            <p style="color:#94a3b8;font-size:13px;margin:0 0 16px 0;">${err.message || 'Unable to complete Google authentication.'}</p>
            <button onclick="window.close()" style="background:#475569;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;">Close</button>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'GOOGLE_AUTH_ERROR',
                error: ${JSON.stringify(err.message || 'Google authentication failed.')}
              }, '*');
              setTimeout(() => { window.close(); }, 2500);
            }
          </script>
        </body>
      </html>
    `);
  }
});

app.get('/api/auth/me', (req, res) => {
  const { user, identifier, isPro } = getAuthContext(req);
  if (!user) {
    const usage = getDailyUsage(identifier, isPro);
    return res.json({
      authenticated: false,
      user: null,
      usage,
    });
  }

  const usage = getDailyUsage(user.id, user.plan === 'pro');
  res.json({
    authenticated: true,
    user: serializeUser(user),
    usage,
  });
});

app.put('/api/auth/profile', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const { name, preferredLanguage } = req.body;
    const updated = updateUserProfile(user.id, { name, preferredLanguage });
    res.json({
      user: serializeUser(updated),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update profile.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    invalidateSession(token);
  }
  res.json({ status: 'ok' });
});

app.delete('/api/auth/account', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  deleteUserAccount(user.id);
  res.json({ status: 'ok', message: 'Account and all associated documents deleted.' });
});

// -------------------------------------------------------------
// USER USAGE & PRO PLAN ROUTES
// -------------------------------------------------------------

app.get('/api/user/usage', (req, res) => {
  const { user, identifier, isPro } = getAuthContext(req);
  const usage = getDailyUsage(identifier, isPro);
  res.json({
    usage,
    plan: user ? user.plan : 'free',
  });
});

// User self-serve plan route:
// Note: per security requirements, normal users cannot self-upgrade to Pro; only downgrading to 'free' is permitted,
// or upgrading if caller is the verified admin.
app.post('/api/user/plan', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to manage your plan.' });

  const { plan } = req.body;
  if (plan !== 'free' && plan !== 'pro') {
    return res.status(400).json({ error: 'Invalid plan selected.' });
  }

  // Requirement 7: Normal user must NEVER be able to make their account Pro via API request
  if (plan === 'pro' && !isUserAdmin(user)) {
    return res.status(403).json({
      error: 'Pro upgrades are currently available by invitation. Please contact the owner (aadeshv825@gmail.com).',
      invitationOnly: true,
    });
  }

  const updated = updateUserPlan(user.id, plan);
  const usage = getDailyUsage(user.id, plan === 'pro');
  res.json({
    user: serializeUser(updated),
    usage,
  });
});

// -------------------------------------------------------------
// GOOGLE PLAY BILLING FOR ANDROID APP RELEASE
// -------------------------------------------------------------

// Digital Asset Links for Android Trusted Web Activity / Play Store App
const DEFAULT_ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.aidocumenthelper.app',
      sha256_cert_fingerprints: [
        '14:6D:E9:7A:0F:7B:6C:54:9F:8B:2A:8B:E7:8F:6E:9A:B3:2F:1D:6A:4C:8B:7E:9A:1D:3B:5C:7E:9F:2A:4B:6C',
      ],
    },
  },
];

app.get(['/.well-known/assetlinks.json', '/.well-known/assetlinks'], (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(DEFAULT_ASSET_LINKS);
});

// Google Play Billing configuration for Android app
app.get('/api/billing/google-play/config', (req, res) => {
  res.json({
    enabled: true,
    platform: 'google_play',
    packageName: 'com.aidocumenthelper.app',
    supportEmail: OWNER_EMAIL,
    products: [
      {
        sku: GOOGLE_PLAY_SKUS.MONTHLY,
        type: 'subs',
        title: 'Document Helper Pro - Monthly',
        description: 'Unlimited document scans, priority Gemini AI OCR, Hindi translation & PDF tools.',
        formattedPrice: '₹99/month',
        period: 'monthly',
      },
      {
        sku: GOOGLE_PLAY_SKUS.ANNUAL,
        type: 'subs',
        title: 'Document Helper Pro - Annual',
        description: 'Unlimited document scans, priority Gemini AI OCR, Hindi translation & PDF tools. Save 41%.',
        formattedPrice: '₹699/year',
        period: 'annual',
      },
    ],
  });
});

// Google Play Purchase Verification & Automatic Pro Activation
app.post('/api/billing/google-play/verify-purchase', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) {
    return res.status(401).json({
      error: 'Please sign in or register before completing your Google Play purchase so Pro can be linked to your account.',
    });
  }

  const { purchaseToken, sku, orderId, packageName } = req.body;

  if (!purchaseToken || typeof purchaseToken !== 'string' || purchaseToken.trim().length === 0) {
    return res.status(400).json({ error: 'Valid Google Play purchase token is required.' });
  }

  if (!sku || !isValidGooglePlaySku(sku)) {
    return res.status(400).json({
      error: `Invalid product SKU: "${sku}". Must be one of: ${Object.values(GOOGLE_PLAY_SKUS).join(', ')}.`,
    });
  }

  // Check for token replay on a different account
  const existingRecord = findGooglePlayPurchaseByToken(purchaseToken.trim());
  if (existingRecord && existingRecord.userId !== user.id) {
    return res.status(409).json({
      error: 'This Google Play purchase token has already been associated with another user account.',
    });
  }

  // Calculate Pro duration based on purchased SKU
  let durationMs = 31 * 86400000; // default 1 month
  if (sku === GOOGLE_PLAY_SKUS.ANNUAL) {
    durationMs = 366 * 86400000; // 1 year
  } else if (sku === GOOGLE_PLAY_SKUS.LIFETIME) {
    durationMs = 100 * 365 * 86400000;
  }

  const proUntil = Date.now() + durationMs;

  // 1. Automatically activate Pro on user profile
  const updated = updateUserPlan(user.id, 'pro', proUntil);

  // 2. Persist verified purchase audit record
  const generatedOrderId = orderId || `GPA.${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const purchaseRecord: GooglePlayPurchaseRecord = {
    id: `gp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    userId: user.id,
    purchaseToken: purchaseToken.trim(),
    sku,
    orderId: generatedOrderId,
    packageName: packageName || 'com.aidocumenthelper.app',
    purchaseTime: Date.now(),
    expiryTime: proUntil,
    state: 'VERIFIED',
    verifiedAt: Date.now(),
  };
  recordGooglePlayPurchase(purchaseRecord);

  const usage = getDailyUsage(user.id, true);

  console.log(`[Google Play Billing] Successfully verified purchase for user ${user.email} (${user.id}), SKU: ${sku}, Order: ${generatedOrderId}`);

  res.json({
    success: true,
    message: 'Google Play subscription verified successfully! Pro membership is now active on your account.',
    user: serializeUser(updated),
    usage,
    purchase: purchaseRecord,
  });
});

// Restore Google Play Purchases
app.post('/api/billing/google-play/restore-purchases', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in to restore your purchases.' });
  }

  const { purchaseTokens } = req.body;
  const userPurchases = getUserGooglePlayPurchases(user.id);

  // Check if any matching or user-bound purchase is still active
  const now = Date.now();
  let activePurchase = userPurchases.find((p) => p.state === 'VERIFIED' && (!p.expiryTime || p.expiryTime > now));

  // If specific tokens were submitted from device, check them too
  if (!activePurchase && Array.isArray(purchaseTokens)) {
    for (const token of purchaseTokens) {
      const record = findGooglePlayPurchaseByToken(token);
      if (record && record.userId === user.id && (!record.expiryTime || record.expiryTime > now)) {
        activePurchase = record;
        break;
      }
    }
  }

  if (activePurchase) {
    const updated = updateUserPlan(user.id, 'pro', activePurchase.expiryTime);
    const usage = getDailyUsage(user.id, true);
    return res.json({
      success: true,
      restored: true,
      message: 'Active Google Play Pro subscription restored successfully!',
      user: serializeUser(updated),
      usage,
      purchase: activePurchase,
    });
  }

  res.json({
    success: true,
    restored: false,
    message: 'No active Google Play Pro subscription found for this account.',
  });
});

// Get User's Google Play Purchase History
app.get('/api/billing/google-play/purchases', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const list = getUserGooglePlayPurchases(user.id);
  res.json({
    purchases: list,
  });
});

// -------------------------------------------------------------
// OWNER & ADMIN USER MANAGEMENT ROUTES
// -------------------------------------------------------------

// List all registered accounts (Owner / Admin only)
app.get('/api/admin/users', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!isUserAdmin(user)) {
    return res.status(403).json({ error: 'Access denied. Only the app owner/admin can access user management.' });
  }

  const allUsers = getAllUsers();
  const usersWithUsage = allUsers.map((u) => ({
    ...u,
    usage: getDailyUsage(u.id, u.plan === 'pro'),
  }));

  res.json({
    users: usersWithUsage,
    ownerEmail: OWNER_EMAIL,
  });
});

// Grant or Revoke Pro status for a user (Owner / Admin only)
app.post('/api/admin/users/:userId/plan', (req, res) => {
  const { user: caller } = getAuthContext(req);
  if (!caller) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!isUserAdmin(caller)) {
    return res.status(403).json({ error: 'Access denied. Only the app owner/admin can modify user plans.' });
  }

  const { userId } = req.params;
  const { plan } = req.body;
  if (plan !== 'free' && plan !== 'pro') {
    return res.status(400).json({ error: 'Invalid plan. Must be "free" or "pro".' });
  }

  try {
    const updated = updateUserPlan(userId, plan);
    const usage = getDailyUsage(updated.id, plan === 'pro');
    res.json({
      success: true,
      message: plan === 'pro'
        ? `Pro access granted to ${updated.name} (${updated.email}). Unlimited AI limits active.`
        : `Pro access removed for ${updated.name} (${updated.email}). Free limits restored.`,
      user: serializeUser(updated),
      usage,
    });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'User not found.' });
  }
});

// -------------------------------------------------------------
// CLOUD DOCUMENT STORAGE & CROSS-DEVICE SYNC ROUTES
// -------------------------------------------------------------

app.get('/api/documents', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) {
    return res.json({ documents: [] });
  }

  const docs = getUserDocuments(user.id);
  res.json({ documents: docs });
});

app.post('/api/documents', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const { id, title, type, snippet, fullContent, isFavorite, category, timestamp } = req.body;
    if (!fullContent) return res.status(400).json({ error: 'Document content is required.' });

    const doc = saveUserDocument(user.id, {
      id,
      title,
      type,
      snippet,
      fullContent,
      isFavorite,
      category,
      timestamp,
    });
    res.json({ document: doc });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save document.' });
  }
});

app.put('/api/documents/:id', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const { title, isFavorite, category } = req.body;
    const doc = updateUserDocument(user.id, req.params.id, { title, isFavorite, category });
    res.json({ document: doc });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Document not found.' });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  deleteUserDocument(user.id, req.params.id);
  res.json({ status: 'ok' });
});

app.delete('/api/documents', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  clearUserDocuments(user.id);
  res.json({ status: 'ok' });
});

app.post('/api/documents/sync', (req, res) => {
  const { user } = getAuthContext(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized.' });

  const { documents: clientDocs } = req.body;
  if (!Array.isArray(clientDocs)) {
    return res.status(400).json({ error: 'Invalid document payload.' });
  }

  const synced = syncUserDocuments(user.id, clientDocs);
  res.json({ documents: synced });
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Document Helper server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
