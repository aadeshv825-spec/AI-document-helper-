import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PostgresStore } from './db.ts';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  salt?: string;
  passwordIterations?: number;
  googleId?: string;
  avatarUrl?: string;
  authProvider?: 'password' | 'google';
  plan: 'free' | 'pro';
  role?: 'admin' | 'user';
  proUntil?: number;
  createdAt: number;
  preferredLanguage?: string;
}

export interface GooglePlayPurchaseRecord {
  id: string;
  userId: string;
  purchaseToken: string;
  sku: string;
  orderId?: string;
  packageName?: string;
  purchaseTime: number;
  expiryTime?: number;
  state:
    | 'VERIFIED'
    | 'ACTIVE'
    | 'CANCELED'
    | 'EXPIRED'
    | 'PAUSED'
    | 'IN_GRACE_PERIOD'
    | 'ON_HOLD'
    | 'PENDING'
    | 'PENDING_PURCHASE_CANCELED'
    | 'REVOKED'
    | 'INVALID';
  verifiedAt: number;
  linkedPurchaseToken?: string;
  obfuscatedExternalAccountId?: string;
  latestSuccessfulOrderId?: string;
}

interface ProcessedRtdnEvent {
  messageId: string;
  processedAt: number;
}

export interface StoredDocument {
  id: string;
  userId: string;
  title: string;
  type: string;
  snippet: string;
  fullContent: string;
  timestamp: number;
  isFavorite: boolean;
  category: string;
}

interface StoredSession {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export const FREE_DAILY_LIMIT = 5;

function getDataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn('[Store] Could not create DATA_DIR:', err);
  }
  return dir;
}

function getFilePath(filename: string): string {
  return path.join(getDataDir(), filename);
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as T;
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return defaultValue;
}

function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

let pgStore: PostgresStore | null = null;

// In-memory cache for speed, backed by file writes or PostgreSQL
let users: StoredUser[] = [];
let sessions: StoredSession[] = [];
let documents: StoredDocument[] = [];
let usageMap: Record<string, number> = {};
let purchases: GooglePlayPurchaseRecord[] = [];
let processedRtdnEvents: ProcessedRtdnEvent[] = [];

// App owner & admin email
export const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'aadeshv825@gmail.com').toLowerCase();

export function isUserAdmin(user: StoredUser | null | undefined): boolean {
  if (!user) return false;
  // If user claims to be the owner, require authenticating via Google to claim admin privileges
  if (user.email && user.email.toLowerCase() === OWNER_EMAIL) {
    return user.authProvider === 'google';
  }
  return user.role === 'admin';
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex');
}

function verifyHash(password: string, salt: string, expectedHash: string, iterations?: number): boolean {
  const iters = iterations || (expectedHash.length === 128 ? 1000 : 310000);
  if (crypto.pbkdf2Sync(password, salt, iters, 64, 'sha512').toString('hex') === expectedHash) {
    return true;
  }
  if (crypto.pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('hex') === expectedHash) {
    return true;
  }
  if (crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex') === expectedHash) {
    return true;
  }
  return false;
}

export function isUserPro(user: StoredUser | null | undefined): boolean {
  if (!user) return false;
  if (user.plan !== 'pro') return false;
  if (user.proUntil && user.proUntil < Date.now()) {
    return false;
  }
  return true;
}

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export async function initStore(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (dbUrl) {
    try {
      pgStore = new PostgresStore(dbUrl);
      await pgStore.connectAndMigrate();
      const loaded = await pgStore.loadAll();
      users = loaded.users || [];
      sessions = loaded.sessions || [];
      documents = loaded.documents || [];
      usageMap = loaded.usage || {};
      purchases = loaded.purchases || [];
      console.log(`[Store] Initialized PostgreSQL store from ${dbUrl.replace(/:[^:]*@/, ':***@')}`);
      return;
    } catch (err) {
      console.error('[Store] Failed to connect to PostgreSQL:', err);
      if (process.env.REQUIRE_DATABASE === 'true') {
        throw err;
      }
    }
  }

  // Load from JSON storage
  users = readJsonFile<StoredUser[]>(getFilePath('users.json'), []);
  sessions = readJsonFile<any[]>(getFilePath('sessions.json'), []).map((s) => {
    if (s.token && !s.tokenHash) {
      return {
        tokenHash: crypto.createHash('sha256').update(s.token).digest('hex'),
        userId: s.userId,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      };
    }
    return s;
  });
  documents = readJsonFile<StoredDocument[]>(getFilePath('documents.json'), []);
  usageMap = readJsonFile<Record<string, number>>(getFilePath('usage.json'), {});
  purchases = readJsonFile<GooglePlayPurchaseRecord[]>(getFilePath('purchases.json'), []);

  // Ensure owner user exists in local dev mode
  const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD;
  if (!users.some((u) => u.email.toLowerCase() === OWNER_EMAIL)) {
    let passwordHash: string | undefined;
    let salt: string | undefined;
    if (ADMIN_INITIAL_PASSWORD && ADMIN_INITIAL_PASSWORD.trim().length >= 6) {
      salt = crypto.randomBytes(16).toString('hex');
      passwordHash = hashPassword(ADMIN_INITIAL_PASSWORD.trim(), salt);
    }

    users.push({
      id: 'user_owner_admin',
      name: 'Aadesh V',
      email: OWNER_EMAIL,
      passwordHash,
      salt,
      passwordIterations: 310000,
      plan: 'free',
      role: 'admin',
      createdAt: Date.now() - 86400000 * 7,
      preferredLanguage: 'English',
      authProvider: 'google',
    });
    writeJsonFile(getFilePath('users.json'), users);
  }
}

// Initial auto-load at module import
void initStore().catch((err) => {
  console.warn('[Store] Initial auto-load note:', err?.message || err);
});

// -------------------------------------------------------------
// USER MANAGEMENT
// -------------------------------------------------------------

export function registerUser(name: string, email: string, password: string): { user: StoredUser; token: string } {
  const normalizedEmail = email.trim().toLowerCase();
  if (users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
    throw new Error('An account with this email address already exists. Please sign in.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const newUser: StoredUser = {
    id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    name: name.trim() || 'User',
    email: normalizedEmail,
    passwordHash,
    salt,
    passwordIterations: 310000,
    plan: 'free',
    role: 'user', // Password registration is always normal user
    createdAt: Date.now(),
    preferredLanguage: 'English',
    authProvider: 'password',
  };

  users.push(newUser);
  writeJsonFile(getFilePath('users.json'), users);
  if (pgStore) {
    pgStore.upsertUser(newUser);
  }

  const token = createSession(newUser.id);
  return { user: newUser, token };
}

export function authenticateUser(email: string, password: string): { user: StoredUser; token: string } {
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!user) {
    throw new Error('No account found with this email address.');
  }

  if (!user.passwordHash || !user.salt) {
    throw new Error('This account was created with Google. Please use "Continue with Google" to sign in.');
  }

  const valid = verifyHash(password, user.salt, user.passwordHash, user.passwordIterations);
  if (!valid) {
    throw new Error('Incorrect password. Please verify your credentials and try again.');
  }

  const token = createSession(user.id);
  return { user, token };
}

export function setUserPassword(userId: string, newPassword: string): void {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
  const user = users.find((u) => u.id === userId);
  if (!user) {
    throw new Error('User not found.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  user.passwordHash = passwordHash;
  user.salt = salt;
  user.passwordIterations = 310000;
  user.authProvider = user.authProvider || 'password';

  // Invalidate all existing sessions for this user
  sessions = sessions.filter((s) => s.userId !== userId);
  writeJsonFile(getFilePath('users.json'), users);
  writeJsonFile(getFilePath('sessions.json'), sessions);
  if (pgStore) {
    pgStore.upsertUser(user);
    pgStore.deleteSessionsForUser(userId);
  }
}

export function verifyUserPassword(userId: string, password: string): boolean {
  const user = users.find((u) => u.id === userId);
  if (!user || !user.passwordHash || !user.salt) return false;
  return verifyHash(password, user.salt, user.passwordHash, user.passwordIterations);
}

export function findOrCreateGoogleUser(profile: {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}): { user: StoredUser; token: string } {
  const normalizedEmail = profile.email.toLowerCase().trim();
  let user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

  if (user) {
    user.googleId = profile.googleId;
    user.authProvider = 'google';
    if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
    if (profile.name && (!user.name || user.name === 'User' || user.name === 'Google User')) {
      user.name = profile.name;
    }
    // If owner signed in through verified Google, assign admin
    if (normalizedEmail === OWNER_EMAIL) {
      user.role = 'admin';
    }
    writeJsonFile(getFilePath('users.json'), users);
    if (pgStore) {
      pgStore.upsertUser(user);
    }
  } else {
    user = {
      id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      name: profile.name || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      googleId: profile.googleId,
      avatarUrl: profile.avatarUrl,
      authProvider: 'google',
      plan: 'free',
      role: normalizedEmail === OWNER_EMAIL ? 'admin' : 'user',
      createdAt: Date.now(),
      preferredLanguage: 'English',
    };
    users.push(user);
    writeJsonFile(getFilePath('users.json'), users);
    if (pgStore) {
      pgStore.upsertUser(user);
    }
  }

  const token = createSession(user.id);
  return { user, token };
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const newSession: StoredSession = {
    tokenHash,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };

  sessions = sessions.filter((s) => s.expiresAt > Date.now());
  sessions.push(newSession);
  writeJsonFile(getFilePath('sessions.json'), sessions);
  if (pgStore) {
    pgStore.upsertSession(newSession);
  }
  return token;
}

export function getUserByToken(token: string): StoredUser | null {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = sessions.find((s) => s.tokenHash === tokenHash && s.expiresAt > Date.now());
  if (!session) return null;
  return users.find((u) => u.id === session.userId) || null;
}

export function getUserById(userId: string): StoredUser | null {
  return users.find((u) => u.id === userId) || null;
}

export function getUserByEmail(email: string): StoredUser | null {
  const normalized = email.trim().toLowerCase();
  return users.find((u) => u.email.toLowerCase() === normalized) || null;
}

export function updateUserProfile(
  userId: string,
  updates: { name?: string; preferredLanguage?: string }
): StoredUser {
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found');

  if (updates.name !== undefined) user.name = updates.name.trim();
  if (updates.preferredLanguage !== undefined) user.preferredLanguage = updates.preferredLanguage;

  writeJsonFile(getFilePath('users.json'), users);
  if (pgStore) {
    pgStore.upsertUser(user);
  }
  return user;
}

export function updateUserPlan(userId: string, plan: 'free' | 'pro', proUntil?: number): StoredUser {
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found');

  user.plan = plan;
  if (plan === 'pro') {
    user.proUntil = proUntil || Date.now() + 30 * 24 * 60 * 60 * 1000;
  } else {
    user.proUntil = undefined;
  }

  writeJsonFile(getFilePath('users.json'), users);
  if (pgStore) {
    pgStore.upsertUser(user);
  }
  return user;
}

export function getAllUsers(): Array<Omit<StoredUser, 'passwordHash' | 'salt'> & { isAdmin: boolean }> {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    authProvider: u.authProvider,
    plan: u.plan,
    role: isUserAdmin(u) ? 'admin' : 'user',
    isAdmin: isUserAdmin(u),
    proUntil: u.proUntil,
    createdAt: u.createdAt,
    preferredLanguage: u.preferredLanguage,
  }));
}

export function invalidateSession(token: string): void {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  sessions = sessions.filter((s) => s.tokenHash !== tokenHash);
  writeJsonFile(getFilePath('sessions.json'), sessions);
  if (pgStore) {
    pgStore.deleteSession(tokenHash);
  }
}

export function deleteUserAccount(userId: string): void {
  users = users.filter((u) => u.id !== userId);
  sessions = sessions.filter((s) => s.userId !== userId);
  documents = documents.filter((d) => d.userId !== userId);

  writeJsonFile(getFilePath('users.json'), users);
  writeJsonFile(getFilePath('sessions.json'), sessions);
  writeJsonFile(getFilePath('documents.json'), documents);
  if (pgStore) {
    pgStore.deleteUser(userId);
    pgStore.deleteSessionsForUser(userId);
    pgStore.deleteDocumentsForUser(userId);
  }
}

// -------------------------------------------------------------
// DOCUMENT STORAGE & SYNC
// -------------------------------------------------------------

export function getUserDocuments(userId: string): StoredDocument[] {
  return documents
    .filter((d) => d.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function saveUserDocument(
  userId: string,
  doc: {
    id?: string;
    title: string;
    type: string;
    snippet?: string;
    fullContent: string;
    isFavorite?: boolean;
    category?: string;
    timestamp?: number;
  }
): StoredDocument {
  const docId = doc.id || `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const existingIdx = documents.findIndex((d) => d.userId === userId && d.id === docId);

  const snippet = doc.snippet || doc.fullContent.replace(/\n+/g, ' ').slice(0, 120) + '...';
  const newDoc: StoredDocument = {
    id: docId,
    userId,
    title: doc.title || 'Untitled Document',
    type: doc.type || 'home',
    snippet,
    fullContent: doc.fullContent,
    timestamp: doc.timestamp || Date.now(),
    isFavorite: Boolean(doc.isFavorite),
    category: doc.category || 'General',
  };

  if (existingIdx >= 0) {
    documents[existingIdx] = newDoc;
  } else {
    documents.unshift(newDoc);
  }

  writeJsonFile(getFilePath('documents.json'), documents);
  if (pgStore) {
    pgStore.upsertDocument(newDoc);
  }
  return newDoc;
}

export function updateUserDocument(
  userId: string,
  docId: string,
  updates: { title?: string; isFavorite?: boolean; category?: string }
): StoredDocument {
  const doc = documents.find((d) => d.userId === userId && d.id === docId);
  if (!doc) throw new Error('Document not found');

  if (updates.title !== undefined) doc.title = updates.title.trim();
  if (updates.isFavorite !== undefined) doc.isFavorite = updates.isFavorite;
  if (updates.category !== undefined) doc.category = updates.category;

  writeJsonFile(getFilePath('documents.json'), documents);
  if (pgStore) {
    pgStore.upsertDocument(doc);
  }
  return doc;
}

export function deleteUserDocument(userId: string, docId: string): void {
  documents = documents.filter((d) => !(d.userId === userId && d.id === docId));
  writeJsonFile(getFilePath('documents.json'), documents);
  if (pgStore) {
    pgStore.deleteDocument(userId, docId);
  }
}

export function clearUserDocuments(userId: string): void {
  documents = documents.filter((d) => d.userId !== userId);
  writeJsonFile(getFilePath('documents.json'), documents);
  if (pgStore) {
    pgStore.deleteDocumentsForUser(userId);
  }
}

export function syncUserDocuments(
  userId: string,
  clientDocs: Array<{
    id: string;
    title: string;
    type: string;
    snippet: string;
    fullContent: string;
    timestamp: number;
    isFavorite?: boolean;
    category?: string;
  }>
): StoredDocument[] {
  for (const clientDoc of clientDocs) {
    const existing = documents.find((d) => d.userId === userId && (d.id === clientDoc.id || d.fullContent === clientDoc.fullContent));
    if (!existing) {
      const doc: StoredDocument = {
        id: clientDoc.id || `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        userId,
        title: clientDoc.title || 'Saved Document',
        type: clientDoc.type || 'home',
        snippet: clientDoc.snippet || clientDoc.fullContent.slice(0, 100),
        fullContent: clientDoc.fullContent,
        timestamp: clientDoc.timestamp || Date.now(),
        isFavorite: Boolean(clientDoc.isFavorite),
        category: clientDoc.category || 'General',
      };
      documents.unshift(doc);
      if (pgStore) {
        pgStore.upsertDocument(doc);
      }
    }
  }

  writeJsonFile(getFilePath('documents.json'), documents);
  return getUserDocuments(userId);
}

// -------------------------------------------------------------
// SERVER-SIDE RATE LIMITING & USAGE MANAGEMENT
// -------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string, maxRequestsPerMinute = 60): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now > record.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= maxRequestsPerMinute) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count += 1;
  return { allowed: true };
}

export function getDailyUsage(identifier: string, isPro: boolean): { dailyUsed: number; dailyLimit: number; dateString: string } {
  const today = getTodayString();
  const key = `${identifier}_${today}`;
  const dailyUsed = usageMap[key] || 0;
  return {
    dailyUsed,
    dailyLimit: isPro ? 999999 : FREE_DAILY_LIMIT,
    dateString: today,
  };
}

export function canPerformAiAction(identifier: string, isPro: boolean): boolean {
  if (isPro) return true;
  const usage = getDailyUsage(identifier, isPro);
  return usage.dailyUsed < FREE_DAILY_LIMIT;
}

export function reserveDailyUsage(identifier: string, isPro: boolean): { allowed: boolean; key: string } {
  if (isPro) {
    return { allowed: true, key: '' };
  }
  const today = getTodayString();
  const key = `${identifier}_${today}`;
  const current = usageMap[key] || 0;
  if (current >= FREE_DAILY_LIMIT) {
    return { allowed: false, key: '' };
  }
  usageMap[key] = current + 1;
  writeJsonFile(getFilePath('usage.json'), usageMap);
  if (pgStore) {
    pgStore.upsertUsage(key, usageMap[key]);
  }
  return { allowed: true, key };
}

export function releaseDailyUsage(key: string): void {
  if (!key) return;
  const current = usageMap[key] || 0;
  if (current > 0) {
    usageMap[key] = current - 1;
    writeJsonFile(getFilePath('usage.json'), usageMap);
    if (pgStore) {
      pgStore.upsertUsage(key, usageMap[key]);
    }
  }
}

export function incrementDailyUsage(identifier: string): number {
  const today = getTodayString();
  const key = `${identifier}_${today}`;
  const current = usageMap[key] || 0;
  usageMap[key] = current + 1;
  writeJsonFile(getFilePath('usage.json'), usageMap);
  if (pgStore) {
    pgStore.upsertUsage(key, usageMap[key]);
  }
  return usageMap[key];
}

// -------------------------------------------------------------
// GOOGLE PLAY BILLING PURCHASE STORE
// -------------------------------------------------------------

export const GOOGLE_PLAY_SKUS = {
  MONTHLY: 'ai_doc_pro_monthly',
  ANNUAL: 'ai_doc_pro_annual',
} as const;

export function isValidGooglePlaySku(sku: string): boolean {
  return Object.values(GOOGLE_PLAY_SKUS).includes(sku as any);
}

export function findGooglePlayPurchaseByToken(purchaseToken: string): GooglePlayPurchaseRecord | null {
  if (!purchaseToken) return null;
  return purchases.find((p) => p.purchaseToken === purchaseToken) || null;
}

export function getUserGooglePlayPurchases(userId: string): GooglePlayPurchaseRecord[] {
  return purchases.filter((p) => p.userId === userId);
}

export function getAllGooglePlayPurchases(): GooglePlayPurchaseRecord[] {
  return [...purchases];
}

export function recordGooglePlayPurchase(record: GooglePlayPurchaseRecord): GooglePlayPurchaseRecord {
  const existing = purchases.find((p) => p.purchaseToken === record.purchaseToken);
  if (existing) {
    if (existing.userId !== record.userId) {
      throw new Error(`Google Play purchase token is already registered to user ${existing.userId}. Cannot transfer purchase tokens between accounts.`);
    }
    Object.assign(existing, record);
  } else {
    purchases.unshift(record);
  }
  writeJsonFile(getFilePath('purchases.json'), purchases);
  if (pgStore) {
    pgStore.upsertPurchase(record);
  }
  return record;
}

export function getWriteMark(): number {
  return pgStore ? pgStore.writeMark() : Date.now();
}

export async function confirmPersisted(mark: number): Promise<boolean> {
  if (pgStore) {
    return pgStore.waitForWrites(mark);
  }
  return true;
}
