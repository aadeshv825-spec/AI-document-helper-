import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  PostgresStore,
  PersistedSession,
} from './db.ts';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  salt?: string;
  passwordHashIterations?: number;
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
  // REVOKED: refunded or revoked by Google Play (voided purchase).
  state: 'VERIFIED' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';
  // Last Google subscriptionState seen (for support/debugging).
  googleState?: string;
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

// Session tokens are never stored in plaintext. Only a SHA-256
// hash of the bearer token is kept in memory and on disk.
type StoredSession = PersistedSession;

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const DOCUMENTS_FILE = path.join(DATA_DIR, 'documents.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const PURCHASES_FILE = path.join(DATA_DIR, 'purchases.json');

// -------------------------------------------------------------
// STORAGE BACKEND SELECTION
// -------------------------------------------------------------
//
// - DATABASE_URL set   -> PostgreSQL (permanent storage).
// - DATABASE_URL unset -> local JSON files under data/ (development
//   only; NOT permanent on Cloud Run).

const DATABASE_URL = (
  process.env.DATABASE_URL || ''
).trim();

const REQUIRE_DATABASE =
  process.env.REQUIRE_DATABASE === 'true';

let db: PostgresStore | null = null;

export type StorageBackendName =
  | 'postgres'
  | 'json-file';

export function getStorageBackendName(): StorageBackendName {
  return DATABASE_URL ? 'postgres' : 'json-file';
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (err) {
    // Preserve the unreadable file so it is never overwritten.
    const backupPath = `${filePath}.corrupt-${Date.now()}`;

    try {
      fs.copyFileSync(filePath, backupPath);
      console.error(
        `Error reading ${filePath}. A copy was preserved at ${backupPath}.`,
        err
      );
    } catch (copyErr) {
      console.error(
        `Error reading ${filePath} and failed to preserve a backup copy.`,
        err,
        copyErr
      );

      throw new Error(
        `Refusing to continue: ${path.basename(filePath)} is unreadable and could not be backed up.`
      );
    }
  }

  return defaultValue;
}

// Tracks JSON file write failures so callers can report them.
let jsonWriteSeq = 0;
const jsonFailedWriteSeqs: number[] = [];

function writeJsonFile<T>(filePath: string, data: T): void {
  jsonWriteSeq += 1;
  const seq = jsonWriteSeq;

  // Atomic write: write a temp file, then rename over the target.
  const tempPath =
    `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

  try {
    ensureDataDir();

    fs.writeFileSync(
      tempPath,
      JSON.stringify(data, null, 2),
      { encoding: 'utf-8', mode: 0o600 }
    );

    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);

    jsonFailedWriteSeqs.push(seq);
    if (jsonFailedWriteSeqs.length > 1000) jsonFailedWriteSeqs.shift();

    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // ignore
    }
  }
}

export function hashSessionToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

// Converts legacy sessions that stored the raw bearer token into
// hashed sessions. The session stays valid for the same token.
function normalizeSessions(raw: unknown): {
  sessions: StoredSession[];
  converted: boolean;
} {
  if (!Array.isArray(raw)) {
    return { sessions: [], converted: false };
  }

  let converted = false;

  const result: StoredSession[] = [];

  for (const s of raw as any[]) {
    if (!s || typeof s !== 'object') continue;

    let tokenHash: string | undefined =
      typeof s.tokenHash === 'string'
        ? s.tokenHash
        : undefined;

    if (!tokenHash && typeof s.token === 'string' && s.token) {
      tokenHash = hashSessionToken(s.token);
      converted = true;
    }

    if (!tokenHash || typeof s.userId !== 'string') continue;

    result.push({
      tokenHash,
      userId: s.userId,
      createdAt: Number(s.createdAt) || 0,
      expiresAt: Number(s.expiresAt) || 0,
    });
  }

  return { sessions: result, converted };
}

let users: StoredUser[] = [];

let sessions: StoredSession[] = [];

let documents: StoredDocument[] = [];

let usageMap: Record<string, number> = {};

let purchases: GooglePlayPurchaseRecord[] = [];

function loadJsonData(): {
  users: StoredUser[];
  sessions: StoredSession[];
  sessionsConverted: boolean;
  documents: StoredDocument[];
  usage: Record<string, number>;
  purchases: GooglePlayPurchaseRecord[];
} {
  const rawUsers = readJsonFile<unknown>(USERS_FILE, []);
  const rawSessions = readJsonFile<unknown>(SESSIONS_FILE, []);
  const rawDocuments = readJsonFile<unknown>(DOCUMENTS_FILE, []);
  const rawUsage = readJsonFile<unknown>(USAGE_FILE, {});
  const rawPurchases = readJsonFile<unknown>(PURCHASES_FILE, []);

  const normalized = normalizeSessions(rawSessions);

  return {
    users: Array.isArray(rawUsers)
      ? (rawUsers as StoredUser[])
      : [],
    sessions: normalized.sessions,
    sessionsConverted: normalized.converted,
    documents: Array.isArray(rawDocuments)
      ? (rawDocuments as StoredDocument[])
      : [],
    usage:
      rawUsage &&
      typeof rawUsage === 'object' &&
      !Array.isArray(rawUsage)
        ? (rawUsage as Record<string, number>)
        : {},
    purchases: Array.isArray(rawPurchases)
      ? (rawPurchases as GooglePlayPurchaseRecord[])
      : [],
  };
}

// -------------------------------------------------------------
// PERSISTENCE HOOKS (JSON file or PostgreSQL write-through)
// -------------------------------------------------------------

function persistUser(user: StoredUser): void {
  if (db) {
    db.upsertUser(user);
  } else {
    writeJsonFile(USERS_FILE, users);
  }
}

function persistUserDeletion(userId: string): void {
  if (db) {
    db.deleteUser(userId);
  } else {
    writeJsonFile(USERS_FILE, users);
  }
}

function persistSessionInsert(session: StoredSession): void {
  if (db) {
    db.insertSession(session);
  } else {
    writeJsonFile(SESSIONS_FILE, sessions);
  }
}

function persistSessionChanges(change: {
  deletedTokenHash?: string;
  expiredForUser?: { userId: string; now: number };
  allForUser?: string;
}): void {
  if (db) {
    if (change.deletedTokenHash) {
      db.deleteSession(change.deletedTokenHash);
    }

    if (change.expiredForUser) {
      db.deleteExpiredSessionsForUser(
        change.expiredForUser.userId,
        change.expiredForUser.now
      );
    }

    if (change.allForUser) {
      db.deleteSessionsForUser(change.allForUser);
    }
  } else {
    writeJsonFile(SESSIONS_FILE, sessions);
  }
}

function persistDocument(doc: StoredDocument): void {
  if (db) {
    db.upsertDocument(doc);
  } else {
    writeJsonFile(DOCUMENTS_FILE, documents);
  }
}

function persistDocuments(docs: StoredDocument[]): void {
  if (db) {
    for (const doc of docs) {
      db.upsertDocument(doc);
    }
  } else if (docs.length > 0) {
    writeJsonFile(DOCUMENTS_FILE, documents);
  }
}

function persistDocumentDeletion(
  userId: string,
  docId?: string
): void {
  if (db) {
    if (docId) {
      db.deleteDocument(userId, docId);
    } else {
      db.deleteDocumentsForUser(userId);
    }
  } else {
    writeJsonFile(DOCUMENTS_FILE, documents);
  }
}

function persistUsage(key: string, count: number): void {
  if (db) {
    db.upsertUsage(key, count);
  } else {
    writeJsonFile(USAGE_FILE, usageMap);
  }
}

function persistPurchase(record: GooglePlayPurchaseRecord): void {
  if (db) {
    db.upsertPurchase(record);
  } else {
    writeJsonFile(PURCHASES_FILE, purchases);
  }
}

// App owner & admin email
export const OWNER_EMAIL = (
  process.env.OWNER_EMAIL || 'aadeshv825@gmail.com'
)
  .trim()
  .toLowerCase();

/**
 * Admin access:
 * - The owner must have a Google ID and admin role.
 * - Other admin accounts require an explicitly assigned admin role.
 */
export function isUserAdmin(
  user: StoredUser | null | undefined
): boolean {
  if (!user) return false;

  if (user.email?.trim().toLowerCase() === OWNER_EMAIL) {
    return Boolean(user.googleId) && user.role === 'admin';
  }

  return user.role === 'admin';
}

// Only a Google-linked owner account can receive the owner admin role.
function applyOwnerRoleRules(): void {
  const ownerUser = users.find(
    (u) => u.email?.trim().toLowerCase() === OWNER_EMAIL
  );

  if (ownerUser) {
    const expectedRole =
      ownerUser.googleId ? 'admin' : 'user';

    if (ownerUser.role !== expectedRole) {
      ownerUser.role = expectedRole;
      persistUser(ownerUser);
    }
  }
}

// -------------------------------------------------------------
// STORE INITIALISATION
// -------------------------------------------------------------

let storeInitialized = false;

/**
 * Must be awaited before the HTTP server starts listening.
 */
export async function initStore(): Promise<void> {
  if (storeInitialized) return;

  if (!DATABASE_URL) {
    if (REQUIRE_DATABASE) {
      throw new Error(
        'REQUIRE_DATABASE=true but DATABASE_URL is not set. Refusing to start with temporary file storage.'
      );
    }

    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[Store] WARNING: DATABASE_URL is not set. Using local JSON files under data/. ' +
          'This storage is NOT permanent on Cloud Run and will be lost when the instance is replaced.'
      );
    }

    ensureDataDir();

    const loaded = loadJsonData();

    users = loaded.users;
    sessions = loaded.sessions;
    documents = loaded.documents;
    usageMap = loaded.usage;
    purchases = loaded.purchases;

    if (loaded.sessionsConverted) {
      // Remove plaintext session tokens from disk.
      writeJsonFile(SESSIONS_FILE, sessions);
    }

    applyOwnerRoleRules();

    storeInitialized = true;

    return;
  }

  db = new PostgresStore(DATABASE_URL);

  await db.migrate();

  // One-time import of any legacy JSON data present in data/.
  // Existing database rows are never overwritten and the JSON
  // files are left untouched.
  const jsonFilesPresent = [
    USERS_FILE,
    SESSIONS_FILE,
    DOCUMENTS_FILE,
    USAGE_FILE,
    PURCHASES_FILE,
  ].some((f) => fs.existsSync(f));

  if (jsonFilesPresent) {
    const legacy = loadJsonData();

    const result = await db.importJson(
      `startup:${DATA_DIR}`,
      {
        users: legacy.users,
        sessions: legacy.sessions,
        documents: legacy.documents,
        usage: legacy.usage,
        purchases: legacy.purchases,
      }
    );

    if (result.alreadyImported) {
      console.log(
        '[Store] Legacy JSON data was already imported previously; skipping.'
      );
    } else {
      console.log(
        '[Store] Imported legacy JSON data into PostgreSQL.',
        { inserted: result.inserted, skipped: result.skipped }
      );
    }
  }

  const loaded = await db.loadAll();

  users = loaded.users as StoredUser[];
  sessions = loaded.sessions;
  documents = loaded.documents as StoredDocument[];
  usageMap = loaded.usage;
  purchases = loaded.purchases as GooglePlayPurchaseRecord[];

  applyOwnerRoleRules();

  storeInitialized = true;

  console.log(
    `[Store] PostgreSQL storage ready (${users.length} users, ${documents.length} documents, ${purchases.length} purchases).`
  );
}

/**
 * Waits for pending database writes, then closes the connection pool.
 * Call on shutdown.
 */
export async function flushStore(): Promise<void> {
  if (db) {
    await db.close();
  }
}

/**
 * Marks the current position in the database write queue. Pass the
 * result to confirmPersisted() after changing data.
 */
export function getWriteMark(): number {
  return db ? db.writeMark() : jsonWriteSeq;
}

/**
 * Confirms that every change made since `mark` was written to
 * PostgreSQL. JSON file storage writes synchronously, so it always
 * confirms (a failed file write throws earlier).
 */
export async function confirmPersisted(
  mark: number,
  timeoutMs = 10000
): Promise<boolean> {
  if (!db) {
    return !jsonFailedWriteSeqs.some((seq) => seq > mark);
  }

  return db.waitForWrites(mark, timeoutMs);
}

export async function checkDatabaseConnection(): Promise<boolean> {
  return db ? db.ping() : true;
}

export function getStorageStatus(): {
  backend: StorageBackendName;
  pendingWrites: number;
  failedWrites: number;
  connected: boolean;
} {
  const status = db
    ? db.getStatus()
    : { pendingWrites: 0, failedWrites: 0, connected: true };

  return {
    backend: getStorageBackendName(),
    ...status,
  };
}

// -------------------------------------------------------------
// PASSWORD HASHING
// -------------------------------------------------------------

const PASSWORD_HASH_ITERATIONS = 310000;
const LEGACY_PASSWORD_HASH_ITERATIONS = 1000;
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_DIGEST = 'sha512';
const PASSWORD_SALT_BYTES = 16;

// Only these iteration counts are ever accepted.
const ALLOWED_PASSWORD_HASH_ITERATIONS = new Set<number>([
  LEGACY_PASSWORD_HASH_ITERATIONS,
  PASSWORD_HASH_ITERATIONS,
]);

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 1024;

const PASSWORD_HASH_HEX_PATTERN = new RegExp(
  `^[0-9a-f]{${PASSWORD_HASH_KEY_LENGTH * 2}}$`,
  'i'
);

const PASSWORD_SALT_HEX_PATTERN = new RegExp(
  `^[0-9a-f]{${PASSWORD_SALT_BYTES * 2}}$`,
  'i'
);

function hashPassword(
  password: string,
  salt: string,
  iterations: number = PASSWORD_HASH_ITERATIONS
): string {
  if (!ALLOWED_PASSWORD_HASH_ITERATIONS.has(iterations)) {
    throw new Error('Unsupported password hash configuration.');
  }

  return crypto
    .pbkdf2Sync(
      password,
      salt,
      iterations,
      PASSWORD_HASH_KEY_LENGTH,
      PASSWORD_HASH_DIGEST
    )
    .toString('hex');
}

function isPasswordHashMatch(
  computedHash: string,
  storedHash: string
): boolean {
  if (
    !PASSWORD_HASH_HEX_PATTERN.test(computedHash) ||
    !PASSWORD_HASH_HEX_PATTERN.test(storedHash)
  ) {
    return false;
  }

  const computedBuffer =
    Buffer.from(computedHash, 'hex');

  const storedBuffer =
    Buffer.from(storedHash, 'hex');

  if (
    computedBuffer.length !==
      PASSWORD_HASH_KEY_LENGTH ||
    storedBuffer.length !==
      computedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    computedBuffer,
    storedBuffer
  );
}

/**
 * Returns the iteration count for a stored hash, or null if the
 * stored value is not one of the accepted configurations.
 * Missing values are legacy 1,000-iteration hashes.
 */
function resolveStoredIterations(
  user: StoredUser
): number | null {
  if (
    user.passwordHashIterations === undefined ||
    user.passwordHashIterations === null
  ) {
    return LEGACY_PASSWORD_HASH_ITERATIONS;
  }

  const value = Number(user.passwordHashIterations);

  return ALLOWED_PASSWORD_HASH_ITERATIONS.has(value)
    ? value
    : null;
}

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

// -------------------------------------------------------------
// USER MANAGEMENT
// -------------------------------------------------------------

export function registerUser(
  name: string,
  email: string,
  password: string
): { user: StoredUser; token: string } {
  const normalizedEmail = email.trim().toLowerCase();

  // The owner account must use verified Google authentication.
  if (normalizedEmail === OWNER_EMAIL) {
    throw new Error(
      'Owner account must sign in with Google.'
    );
  }

  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long.`
    );
  }

  if (
    users.some(
      (u) => u.email.toLowerCase() === normalizedEmail
    )
  ) {
    throw new Error(
      'An account with this email address already exists. Please sign in.'
    );
  }

  const salt = crypto
    .randomBytes(PASSWORD_SALT_BYTES)
    .toString('hex');

  const passwordHash = hashPassword(
    password,
    salt,
    PASSWORD_HASH_ITERATIONS
  );

  const newUser: StoredUser = {
    id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    name: name.trim().slice(0, 100) || 'User',
    email: normalizedEmail,
    passwordHash,
    salt,
    passwordHashIterations:
      PASSWORD_HASH_ITERATIONS,
    plan: 'free',
    role: 'user',
    createdAt: Date.now(),
    preferredLanguage: 'English',
  };

  users.push(newUser);

  persistUser(newUser);

  const token = createSession(
    newUser.id
  );

  return {
    user: newUser,
    token,
  };
}

export function authenticateUser(
  email: string,
  password: string
): { user: StoredUser; token: string } {
  const normalizedEmail =
    email.trim().toLowerCase();

  const user = users.find(
    (u) =>
      u.email.toLowerCase() ===
      normalizedEmail
  );

  if (!user) {
    throw new Error(
      'Incorrect email or password.'
    );
  }

  if (!user.passwordHash || !user.salt) {
    throw new Error(
      'This account was created with Google. Please use "Continue with Google" to sign in.'
    );
  }

  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      'Incorrect email or password.'
    );
  }

  const storedIterations =
    resolveStoredIterations(user);

  if (
    storedIterations === null ||
    !PASSWORD_SALT_HEX_PATTERN.test(user.salt) ||
    !PASSWORD_HASH_HEX_PATTERN.test(user.passwordHash)
  ) {
    console.error(
      `[Auth] Stored password hash for user ${user.id} has an unsupported format; login rejected.`
    );

    throw new Error(
      'Incorrect email or password.'
    );
  }

  const computedHash =
    hashPassword(
      password,
      user.salt,
      storedIterations
    );

  if (
    !isPasswordHashMatch(
      computedHash,
      user.passwordHash
    )
  ) {
    throw new Error(
      'Incorrect email or password.'
    );
  }

  // Transparently upgrade legacy hashes after a successful login.
  if (
    storedIterations <
    PASSWORD_HASH_ITERATIONS
  ) {
    const newSalt = crypto
      .randomBytes(PASSWORD_SALT_BYTES)
      .toString('hex');

    user.passwordHash =
      hashPassword(
        password,
        newSalt,
        PASSWORD_HASH_ITERATIONS
      );

    user.salt = newSalt;

    user.passwordHashIterations =
      PASSWORD_HASH_ITERATIONS;

    persistUser(user);
  }

  const token =
    createSession(user.id);

  return {
    user,
    token,
  };
}

export function findOrCreateGoogleUser(
  profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }
): { user: StoredUser; token: string } {
  const normalizedEmail =
    profile.email.trim().toLowerCase();

  let user = users.find(
    (u) =>
      u.email.toLowerCase() ===
      normalizedEmail
  );

  if (user) {
    user.googleId =
      profile.googleId;

    if (
      normalizedEmail ===
      OWNER_EMAIL
    ) {
      user.role = 'admin';
    }

    if (profile.avatarUrl) {
      user.avatarUrl =
        profile.avatarUrl;
    }

    if (
      !user.name ||
      user.name === 'User'
    ) {
      user.name =
        profile.name;
    }

    if (!user.authProvider) {
      user.authProvider =
        'google';
    }

    persistUser(user);
  } else {
    user = {
      id: `user_g_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name:
        profile.name.trim() ||
        'Google User',
      email:
        normalizedEmail,
      googleId:
        profile.googleId,
      avatarUrl:
        profile.avatarUrl,
      authProvider:
        'google',
      plan: 'free',
      role:
        normalizedEmail ===
        OWNER_EMAIL
          ? 'admin'
          : 'user',
      createdAt:
        Date.now(),
      preferredLanguage:
        'English',
    };

    users.push(user);

    persistUser(user);
  }

  const token =
    createSession(user.id);

  return {
    user,
    token,
  };
}

const SESSION_TTL_MS =
  30 * 24 * 60 * 60 * 1000;

// Session files were accidentally committed to the public
// repository before this time. Any session created before it is
// treated as compromised and rejected; users simply sign in again.
const COMPROMISED_SESSION_CUTOFF_MS =
  Date.parse('2026-10-02T06:46:02Z');

export function createSession(
  userId: string
): string {
  const token =
    crypto.randomBytes(32).toString('hex');

  const now = Date.now();

  const newSession:
    StoredSession = {
    tokenHash:
      hashSessionToken(token),
    userId,
    createdAt:
      now,
    expiresAt:
      now +
      SESSION_TTL_MS,
  };

  sessions =
    sessions.filter(
      (s) =>
        s.userId !== userId ||
        s.expiresAt > now
    );

  sessions.push(
    newSession
  );

  if (db) {
    db.deleteExpiredSessionsForUser(userId, now);
    db.insertSession(newSession);
  } else {
    persistSessionInsert(newSession);
  }

  return token;
}

export function getUserByToken(
  token: string
): StoredUser | null {
  if (
    !token ||
    typeof token !== 'string' ||
    token.length > 256
  ) {
    return null;
  }

  const tokenHash =
    hashSessionToken(token);

  const now = Date.now();

  const session =
    sessions.find(
      (s) =>
        s.tokenHash === tokenHash &&
        s.expiresAt > now &&
        s.createdAt >= COMPROMISED_SESSION_CUTOFF_MS
    );

  if (!session) {
    return null;
  }

  return (
    users.find(
      (u) =>
        u.id === session.userId
    ) || null
  );
}

export function getUserById(
  userId: string
): StoredUser | null {
  return (
    users.find(
      (u) => u.id === userId
    ) || null
  );
}

export function updateUserProfile(
  userId: string,
  updates: {
    name?: string;
    preferredLanguage?: string;
  }
): StoredUser {
  const user =
    users.find(
      (u) => u.id === userId
    );

  if (!user) {
    throw new Error(
      'User not found'
    );
  }

  if (
    updates.name !== undefined
  ) {
    if (typeof updates.name !== 'string') {
      throw new Error('Invalid name.');
    }

    const trimmedName = updates.name.trim().slice(0, 100);

    // Keep the existing name rather than saving an empty one.
    if (trimmedName) {
      user.name = trimmedName;
    }
  }

  if (
    updates.preferredLanguage !== undefined
  ) {
    if (
      typeof updates.preferredLanguage !== 'string' ||
      updates.preferredLanguage.length > 50
    ) {
      throw new Error('Invalid preferred language.');
    }

    user.preferredLanguage =
      updates.preferredLanguage;
  }

  persistUser(user);

  return user;
}

export function updateUserPlan(
  userId: string,
  plan: 'free' | 'pro',
  proUntil?: number
): StoredUser {
  const user =
    users.find(
      (u) => u.id === userId
    );

  if (!user) {
    throw new Error(
      'User not found'
    );
  }

  user.plan = plan;

  user.proUntil =
    plan === 'pro'
      ? proUntil ||
        Date.now() +
          365 * 86400000
      : undefined;

  persistUser(user);

  return user;
}

export function getAllUsers(): Array<
  Omit<
    StoredUser,
    'passwordHash' | 'salt' | 'passwordHashIterations'
  > & {
    isAdmin: boolean;
  }
> {
  return users.map(
    (u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl:
        u.avatarUrl,
      authProvider:
        u.authProvider,
      plan: u.plan,
      role: isUserAdmin(u)
        ? 'admin'
        : 'user',
      isAdmin:
        isUserAdmin(u),
      proUntil:
        u.proUntil,
      createdAt:
        u.createdAt,
      preferredLanguage:
        u.preferredLanguage,
    })
  );
}

export function invalidateSession(
  token: string
): void {
  if (!token || typeof token !== 'string') {
    return;
  }

  const tokenHash =
    hashSessionToken(token);

  sessions =
    sessions.filter(
      (s) =>
        s.tokenHash !== tokenHash
    );

  persistSessionChanges({
    deletedTokenHash: tokenHash,
  });
}

export function deleteUserAccount(
  userId: string
): void {
  users =
    users.filter(
      (u) => u.id !== userId
    );

  sessions =
    sessions.filter(
      (s) =>
        s.userId !== userId
    );

  documents =
    documents.filter(
      (d) =>
        d.userId !== userId
    );

  persistUserDeletion(userId);

  persistSessionChanges({
    allForUser: userId,
  });

  persistDocumentDeletion(userId);
}

// -------------------------------------------------------------
// PASSWORD CHANGE & RESET
// -------------------------------------------------------------

export function findUserByEmail(
  email: string
): StoredUser | null {
  if (typeof email !== 'string') return null;

  const normalizedEmail = email.trim().toLowerCase();

  return (
    users.find(
      (u) => u.email.toLowerCase() === normalizedEmail
    ) || null
  );
}

function assertValidNewPassword(password: unknown): asserts password is string {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long.`
    );
  }
}

// Sets a new password with the current hash configuration and revokes
// every existing session of the user, so a leaked or old session can
// no longer be used after a password change or reset.
export function setUserPassword(
  userId: string,
  newPassword: string
): StoredUser {
  const user = users.find((u) => u.id === userId);

  if (!user) {
    throw new Error('User not found.');
  }

  // The owner account must use verified Google authentication.
  if (user.email.toLowerCase() === OWNER_EMAIL) {
    throw new Error(
      'Owner account must sign in with Google.'
    );
  }

  assertValidNewPassword(newPassword);

  const salt = crypto
    .randomBytes(PASSWORD_SALT_BYTES)
    .toString('hex');

  user.passwordHash = hashPassword(
    newPassword,
    salt,
    PASSWORD_HASH_ITERATIONS
  );
  user.salt = salt;
  user.passwordHashIterations = PASSWORD_HASH_ITERATIONS;

  persistUser(user);

  sessions = sessions.filter(
    (s) => s.userId !== userId
  );

  persistSessionChanges({
    allForUser: userId,
  });

  return user;
}

// Verifies the current password of a signed-in user without creating
// a session. Returns false for Google-only accounts.
export function verifyUserPassword(
  userId: string,
  password: unknown
): boolean {
  const user = users.find((u) => u.id === userId);

  if (
    !user ||
    !user.passwordHash ||
    !user.salt ||
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return false;
  }

  const storedIterations = resolveStoredIterations(user);

  if (
    storedIterations === null ||
    !PASSWORD_SALT_HEX_PATTERN.test(user.salt) ||
    !PASSWORD_HASH_HEX_PATTERN.test(user.passwordHash)
  ) {
    return false;
  }

  return isPasswordHashMatch(
    hashPassword(password, user.salt, storedIterations),
    user.passwordHash
  );
}

// -------------------------------------------------------------
// DOCUMENT STORAGE & SYNC
// -------------------------------------------------------------

export const MAX_DOCUMENT_CONTENT_LENGTH = 2_000_000;
export const MAX_SYNC_DOCUMENTS = 500;

function sanitizeText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.slice(0, maxLength);
}

function sanitizeDocumentId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128
  ) {
    return undefined;
  }

  return value;
}

export function getUserDocuments(
  userId: string
): StoredDocument[] {
  return documents
    .filter(
      (d) =>
        d.userId === userId
    )
    .sort(
      (a, b) =>
        b.timestamp -
        a.timestamp
    );
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
  if (
    typeof doc.fullContent !== 'string' ||
    doc.fullContent.length > MAX_DOCUMENT_CONTENT_LENGTH
  ) {
    throw new Error(
      'Document content is invalid or too large.'
    );
  }

  const docId =
    sanitizeDocumentId(doc.id) ||
    `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const existingIdx =
    documents.findIndex(
      (d) =>
        d.userId ===
          userId &&
        d.id === docId
    );

  const snippet =
    sanitizeText(doc.snippet, 500) ||
    doc.fullContent.replace(
      /\n+/g,
      ' '
    ).slice(0, 120) +
      '...';

  const newDoc:
    StoredDocument = {
    id: docId,
    userId,
    title:
      sanitizeText(doc.title, 300) ||
      'Untitled Document',
    type:
      sanitizeText(doc.type, 50) ||
      'home',
    snippet,
    fullContent:
      doc.fullContent,
    timestamp:
      Number.isFinite(Number(doc.timestamp)) &&
      Number(doc.timestamp) > 0
        ? Number(doc.timestamp)
        : Date.now(),
    isFavorite:
      Boolean(
        doc.isFavorite
      ),
    category:
      sanitizeText(doc.category, 100) ||
      'General',
  };

  if (existingIdx >= 0) {
    documents[
      existingIdx
    ] = newDoc;
  } else {
    documents.unshift(
      newDoc
    );
  }

  persistDocument(newDoc);

  return newDoc;
}

export function updateUserDocument(
  userId: string,
  docId: string,
  updates: {
    title?: string;
    isFavorite?: boolean;
    category?: string;
  }
): StoredDocument {
  const doc =
    documents.find(
      (d) =>
        d.userId ===
          userId &&
        d.id === docId
    );

  if (!doc) {
    throw new Error(
      'Document not found'
    );
  }

  if (
    updates.title !==
    undefined
  ) {
    if (typeof updates.title !== 'string') {
      throw new Error('Invalid document title.');
    }

    doc.title =
      updates.title.trim().slice(0, 300);
  }

  if (
    updates.isFavorite !==
    undefined
  ) {
    doc.isFavorite =
      Boolean(updates.isFavorite);
  }

  if (
    updates.category !==
    undefined
  ) {
    if (typeof updates.category !== 'string') {
      throw new Error('Invalid document category.');
    }

    doc.category =
      updates.category.slice(0, 100);
  }

  persistDocument(doc);

  return doc;
}

export function deleteUserDocument(
  userId: string,
  docId: string
): void {
  documents =
    documents.filter(
      (d) =>
        !(
          d.userId ===
            userId &&
          d.id === docId
        )
    );

  persistDocumentDeletion(userId, docId);
}

export function clearUserDocuments(
  userId: string
): void {
  documents =
    documents.filter(
      (d) =>
        d.userId !== userId
    );

  persistDocumentDeletion(userId);
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
  const added: StoredDocument[] = [];

  for (
    const clientDoc of clientDocs.slice(0, MAX_SYNC_DOCUMENTS)
  ) {
    if (
      !clientDoc ||
      typeof clientDoc !== 'object' ||
      typeof clientDoc.fullContent !== 'string' ||
      clientDoc.fullContent.length === 0 ||
      clientDoc.fullContent.length > MAX_DOCUMENT_CONTENT_LENGTH
    ) {
      continue;
    }

    const clientId =
      sanitizeDocumentId(clientDoc.id);

    const existing =
      documents.find(
        (d) =>
          d.userId ===
            userId &&
          (
            (clientId !== undefined &&
              d.id ===
                clientId) ||
            d.fullContent ===
              clientDoc.fullContent
          )
      );

    if (!existing) {
      const newDoc: StoredDocument = {
        id:
          clientId ||
          `doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        userId,
        title:
          sanitizeText(clientDoc.title, 300) ||
          'Saved Document',
        type:
          sanitizeText(clientDoc.type, 50) ||
          'home',
        snippet:
          sanitizeText(clientDoc.snippet, 500) ||
          clientDoc.fullContent.slice(
            0,
            100
          ),
        fullContent:
          clientDoc.fullContent,
        timestamp:
          Number.isFinite(Number(clientDoc.timestamp)) &&
          Number(clientDoc.timestamp) > 0
            ? Number(clientDoc.timestamp)
            : Date.now(),
        isFavorite:
          Boolean(
            clientDoc.isFavorite
          ),
        category:
          sanitizeText(clientDoc.category, 100) ||
          'General',
      };

      documents.unshift(newDoc);

      added.push(newDoc);
    }
  }

  persistDocuments(added);

  return getUserDocuments(
    userId
  );
}

// -------------------------------------------------------------
// SERVER-SIDE RATE LIMITING & USAGE MANAGEMENT
// -------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS =
  60 * 1000;

const ipRequestCounts =
  new Map<
    string,
    {
      count: number;
      resetAt: number;
    }
  >();

// Periodically drop expired rate-limit buckets to bound memory use.
setInterval(() => {
  const now = Date.now();

  for (const [key, record] of ipRequestCounts.entries()) {
    if (now > record.resetAt) {
      ipRequestCounts.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

export function checkRateLimit(
  ip: string,
  maxRequestsPerMinute = 60
): {
  allowed: boolean;
  retryAfter?: number;
} {
  const now =
    Date.now();

  const record =
    ipRequestCounts.get(
      ip
    );

  if (
    !record ||
    now > record.resetAt
  ) {
    ipRequestCounts.set(
      ip,
      {
        count: 1,
        resetAt:
          now +
          RATE_LIMIT_WINDOW_MS,
      }
    );

    return {
      allowed: true,
    };
  }

  if (
    record.count >=
    maxRequestsPerMinute
  ) {
    const retryAfter =
      Math.ceil(
        (
          record.resetAt -
          now
        ) / 1000
      );

    return {
      allowed: false,
      retryAfter,
    };
  }

  record.count += 1;

  return {
    allowed: true,
  };
}

export const FREE_DAILY_LIMIT = 5;

export function getDailyUsage(
  identifier: string,
  isPro: boolean
): {
  dailyUsed: number;
  dailyLimit: number;
  dateString: string;
} {
  const today =
    getTodayString();

  const key =
    `${identifier}_${today}`;

  const dailyUsed =
    usageMap[key] || 0;

  return {
    dailyUsed,
    dailyLimit:
      isPro
        ? 999999
        : FREE_DAILY_LIMIT,
    dateString:
      today,
  };
}

export function canPerformAiAction(
  identifier: string,
  isPro: boolean
): boolean {
  if (isPro) {
    return true;
  }

  const usage =
    getDailyUsage(
      identifier,
      isPro
    );

  return (
    usage.dailyUsed <
    FREE_DAILY_LIMIT
  );
}

export function incrementDailyUsage(
  identifier: string
): number {
  const today =
    getTodayString();

  const key =
    `${identifier}_${today}`;

  const current =
    usageMap[key] || 0;

  usageMap[key] =
    current + 1;

  persistUsage(key, usageMap[key]);

  return usageMap[key];
}

/**
 * Atomically checks the daily limit and reserves one AI action.
 *
 * Node.js runs this synchronously, so two simultaneous requests can
 * never both pass the check for the last remaining free action. The
 * reservation is released with releaseDailyUsage() if the AI request
 * fails, so failed requests do not consume the user's quota.
 */
export function reserveDailyUsage(
  identifier: string,
  isPro: boolean
): {
  allowed: boolean;
  key: string;
  usage: {
    dailyUsed: number;
    dailyLimit: number;
    dateString: string;
  };
} {
  const today = getTodayString();
  const key = `${identifier}_${today}`;
  const current = usageMap[key] || 0;
  const dailyLimit = isPro ? 999999 : FREE_DAILY_LIMIT;

  if (!isPro && current >= FREE_DAILY_LIMIT) {
    return {
      allowed: false,
      key,
      usage: { dailyUsed: current, dailyLimit, dateString: today },
    };
  }

  usageMap[key] = current + 1;
  persistUsage(key, usageMap[key]);

  return {
    allowed: true,
    key,
    usage: { dailyUsed: usageMap[key], dailyLimit, dateString: today },
  };
}

/**
 * Returns a reservation made by reserveDailyUsage(). Uses the stored
 * key so a request that crosses midnight refunds the correct day.
 */
export function releaseDailyUsage(key: string): void {
  const current = usageMap[key] || 0;

  if (current <= 0) return;

  usageMap[key] = current - 1;
  persistUsage(key, usageMap[key]);
}

// -------------------------------------------------------------
// GOOGLE PLAY BILLING PURCHASE STORE
// -------------------------------------------------------------

export const GOOGLE_PLAY_SKUS = {
  MONTHLY:
    'ai_doc_pro_monthly',
  ANNUAL:
    'ai_doc_pro_annual',
  LIFETIME:
    'ai_doc_pro_lifetime',
} as const;

export function isValidGooglePlaySku(
  sku: string
): boolean {
  return Object.values(
    GOOGLE_PLAY_SKUS
  ).includes(
    sku as (typeof GOOGLE_PLAY_SKUS)[keyof typeof GOOGLE_PLAY_SKUS]
  );
}

export function findGooglePlayPurchaseByToken(
  purchaseToken: string
): GooglePlayPurchaseRecord | null {
  if (!purchaseToken) {
    return null;
  }

  return (
    purchases.find(
      (p) =>
        p.purchaseToken ===
        purchaseToken
    ) || null
  );
}

export function getUserGooglePlayPurchases(
  userId: string
): GooglePlayPurchaseRecord[] {
  return purchases.filter(
    (p) =>
      p.userId === userId
  );
}

export function getAllGooglePlayPurchases():
  GooglePlayPurchaseRecord[] {
  return [...purchases];
}

export function recordGooglePlayPurchase(
  record: GooglePlayPurchaseRecord
): GooglePlayPurchaseRecord {
  const idx =
    purchases.findIndex(
      (p) =>
        p.purchaseToken ===
        record.purchaseToken
    );

  if (idx >= 0) {
    // A purchase token can never be moved to a different account.
    if (purchases[idx].userId !== record.userId) {
      throw new Error(
        'This Google Play purchase token is already linked to another account.'
      );
    }

    purchases[idx] =
      record;
  } else {
    purchases.unshift(
      record
    );
  }

  persistPurchase(record);

  return record;
}
