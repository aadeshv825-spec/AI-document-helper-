import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  salt?: string;
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
  state: 'VERIFIED' | 'EXPIRED' | 'CANCELLED';
  verifiedAt: number;
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
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const PURCHASES_FILE = path.join(DATA_DIR, 'purchases.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

// In-memory cache for speed, backed by file writes
let users: StoredUser[] = readJsonFile<StoredUser[]>(USERS_FILE, []);
let sessions: StoredSession[] = readJsonFile<StoredSession[]>(SESSIONS_FILE, []);
let documents: StoredDocument[] = readJsonFile<StoredDocument[]>(DOCUMENTS_FILE, []);
let usageMap: Record<string, number> = readJsonFile<Record<string, number>>(USAGE_FILE, {});
let purchases: GooglePlayPurchaseRecord[] = readJsonFile<GooglePlayPurchaseRecord[]>(PURCHASES_FILE, []);

// App owner & admin email
export const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'aadeshv825@gmail.com').toLowerCase();

export function isUserAdmin(user: StoredUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.email && user.email.toLowerCase() === OWNER_EMAIL) return true;
  return false;
}

// Ensure the owner account has admin role
const ownerUser = users.find((u) => u.email.toLowerCase() === OWNER_EMAIL);
if (ownerUser) {
  ownerUser.role = 'admin';
}

// Seed initial default demo user for effortless instant review
const DEMO_EMAIL = 'aadeshv825@gmail.com';
if (!users.some((u) => u.email.toLowerCase() === DEMO_EMAIL.toLowerCase())) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync('Password123!', salt, 1000, 64, 'sha512').toString('hex');
  users.push({
    id: 'user_demo_1',
    name: 'Aadesh V',
    email: DEMO_EMAIL,
    passwordHash,
    salt,
    plan: 'free',
    role: 'admin',
    createdAt: Date.now() - 86400000 * 7,
    preferredLanguage: 'English',
  });
  writeJsonFile(USERS_FILE, users);

  // Seed sample document for demo user
  documents.push({
    id: 'sample-doc-1',
    userId: 'user_demo_1',
    title: 'Rental Agreement Summary',
    type: 'pdf-summary',
    snippet: 'Residential lease deed for Flat 402, Green Valley Apartments. Rent: ₹26,500/mo.',
    fullContent: 'RENTAL LEASE SUMMARY\nPremises: Flat 402, Green Valley Apartments, Mumbai 400053.\nMonthly Rent: ₹26,500 due on 5th of each month.\nSecurity Deposit: ₹1,00,000.\nNotice Period: 1 month prior written notice.\nKey Terms: Residential use only; subletting prohibited; maintenance charges of ₹2,200/mo payable to RWA directly.',
    timestamp: Date.now() - 3600000,
    isFavorite: true,
    category: 'Contracts & Legal',
  });
  writeJsonFile(DOCUMENTS_FILE, documents);
}

// Seed a registered client user so owner can immediately test Manage Users (Give Pro / Remove Pro)
const SAMPLE_USER_EMAIL = 'rahul.sharma@example.com';
if (!users.some((u) => u.email.toLowerCase() === SAMPLE_USER_EMAIL.toLowerCase())) {
  const salt2 = crypto.randomBytes(16).toString('hex');
  const passwordHash2 = crypto.pbkdf2Sync('Password123!', salt2, 1000, 64, 'sha512').toString('hex');
  users.push({
    id: 'user_client_102',
    name: 'Rahul Sharma',
    email: SAMPLE_USER_EMAIL,
    passwordHash: passwordHash2,
    salt: salt2,
    plan: 'free',
    role: 'user',
    createdAt: Date.now() - 86400000 * 2,
    preferredLanguage: 'Hindi',
  });
  writeJsonFile(USERS_FILE, users);
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

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
    plan: 'free',
    createdAt: Date.now(),
    preferredLanguage: 'English',
  };

  users.push(newUser);
  writeJsonFile(USERS_FILE, users);

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

  const computedHash = hashPassword(password, user.salt);
  if (computedHash !== user.passwordHash) {
    throw new Error('Incorrect password. Please verify your credentials and try again.');
  }

  const token = createSession(user.id);
  return { user, token };
}

export function findOrCreateGoogleUser(profile: {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}): { user: StoredUser; token: string } {
  const normalizedEmail = profile.email.trim().toLowerCase();
  let user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

  if (user) {
    // Existing user: link Google ID and update avatar/name if not custom
    user.googleId = profile.googleId;
    if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
    if (!user.name || user.name === 'User') user.name = profile.name;
    if (!user.authProvider) user.authProvider = 'google';
    writeJsonFile(USERS_FILE, users);
  } else {
    // Brand new user via Google
    user = {
      id: `user_g_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name: profile.name.trim() || 'Google User',
      email: normalizedEmail,
      googleId: profile.googleId,
      avatarUrl: profile.avatarUrl,
      authProvider: 'google',
      plan: 'free',
      createdAt: Date.now(),
      preferredLanguage: 'English',
    };
    users.push(user);
    writeJsonFile(USERS_FILE, users);
  }

  const token = createSession(user.id);
  return { user, token };
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const newSession: StoredSession = {
    token,
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };

  sessions = sessions.filter((s) => s.userId !== userId || s.expiresAt > Date.now());
  sessions.push(newSession);
  writeJsonFile(SESSIONS_FILE, sessions);
  return token;
}

export function getUserByToken(token: string): StoredUser | null {
  if (!token) return null;
  const session = sessions.find((s) => s.token === token && s.expiresAt > Date.now());
  if (!session) return null;
  return users.find((u) => u.id === session.userId) || null;
}

export function getUserById(userId: string): StoredUser | null {
  return users.find((u) => u.id === userId) || null;
}

export function updateUserProfile(
  userId: string,
  updates: { name?: string; preferredLanguage?: string }
): StoredUser {
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found');

  if (updates.name !== undefined) user.name = updates.name.trim();
  if (updates.preferredLanguage !== undefined) user.preferredLanguage = updates.preferredLanguage;

  writeJsonFile(USERS_FILE, users);
  return user;
}

export function updateUserPlan(userId: string, plan: 'free' | 'pro', proUntil?: number): StoredUser {
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found');

  user.plan = plan;
  user.proUntil = plan === 'pro' ? (proUntil || Date.now() + 365 * 86400000) : undefined;
  writeJsonFile(USERS_FILE, users);
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
  sessions = sessions.filter((s) => s.token !== token);
  writeJsonFile(SESSIONS_FILE, sessions);
}

export function deleteUserAccount(userId: string): void {
  users = users.filter((u) => u.id !== userId);
  sessions = sessions.filter((s) => s.userId !== userId);
  documents = documents.filter((d) => d.userId !== userId);

  writeJsonFile(USERS_FILE, users);
  writeJsonFile(SESSIONS_FILE, sessions);
  writeJsonFile(DOCUMENTS_FILE, documents);
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

  writeJsonFile(DOCUMENTS_FILE, documents);
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

  writeJsonFile(DOCUMENTS_FILE, documents);
  return doc;
}

export function deleteUserDocument(userId: string, docId: string): void {
  documents = documents.filter((d) => !(d.userId === userId && d.id === docId));
  writeJsonFile(DOCUMENTS_FILE, documents);
}

export function clearUserDocuments(userId: string): void {
  documents = documents.filter((d) => d.userId !== userId);
  writeJsonFile(DOCUMENTS_FILE, documents);
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
      documents.unshift({
        id: clientDoc.id || `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        userId,
        title: clientDoc.title || 'Saved Document',
        type: clientDoc.type || 'home',
        snippet: clientDoc.snippet || clientDoc.fullContent.slice(0, 100),
        fullContent: clientDoc.fullContent,
        timestamp: clientDoc.timestamp || Date.now(),
        isFavorite: Boolean(clientDoc.isFavorite),
        category: clientDoc.category || 'General',
      });
    }
  }

  writeJsonFile(DOCUMENTS_FILE, documents);
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
    dailyLimit: isPro ? 999999 : 5,
    dateString: today,
  };
}

export function canPerformAiAction(identifier: string, isPro: boolean): boolean {
  if (isPro) return true;
  const usage = getDailyUsage(identifier, isPro);
  return usage.dailyUsed < 5;
}

export function incrementDailyUsage(identifier: string): number {
  const today = getTodayString();
  const key = `${identifier}_${today}`;
  const current = usageMap[key] || 0;
  usageMap[key] = current + 1;
  writeJsonFile(USAGE_FILE, usageMap);
  return usageMap[key];
}

// -------------------------------------------------------------
// GOOGLE PLAY BILLING PURCHASE STORE
// -------------------------------------------------------------

export const GOOGLE_PLAY_SKUS = {
  MONTHLY: 'ai_doc_pro_monthly',
  ANNUAL: 'ai_doc_pro_annual',
  LIFETIME: 'ai_doc_pro_lifetime',
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
  // Update or insert
  const idx = purchases.findIndex((p) => p.purchaseToken === record.purchaseToken);
  if (idx >= 0) {
    purchases[idx] = record;
  } else {
    purchases.unshift(record);
  }
  writeJsonFile(PURCHASES_FILE, purchases);
  return record;
}
