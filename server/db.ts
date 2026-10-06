import pg from 'pg';

// -------------------------------------------------------------
// POSTGRESQL PERSISTENCE (Cloud SQL / any managed PostgreSQL)
// -------------------------------------------------------------
//
// Enabled only when DATABASE_URL is set. The rest of the app keeps
// using the synchronous in-memory store API; this module hydrates
// that cache at startup and writes every mutation through to
// PostgreSQL in order.
//
// IMPORTANT: Because reads are served from the in-memory cache,
// run the Cloud Run service with a single instance
// (--max-instances=1) until reads are moved to the database.

const { Pool } = pg;

export interface PersistedSession {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface LoadedData {
  users: any[];
  sessions: PersistedSession[];
  documents: any[];
  usage: Record<string, number>;
  purchases: any[];
  rtdnEvents: any[];
}

export interface JsonImportInput {
  users: any[];
  sessions: PersistedSession[];
  documents: any[];
  usage: Record<string, number>;
  purchases: any[];
}

export interface JsonImportResult {
  alreadyImported: boolean;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
}

interface Migration {
  version: number;
  name: string;
  statements: string[];
}

// Migrations are append-only. Never edit or reorder an existing
// migration; add a new version instead. No migration drops data.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx
        ON app_users (lower(email))`,
      `CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx
        ON app_sessions (user_id)`,
      `CREATE TABLE IF NOT EXISTS app_documents (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL,
        doc_timestamp BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
      )`,
      `CREATE TABLE IF NOT EXISTS app_usage (
        usage_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS app_purchases (
        purchase_token TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS app_purchases_user_id_idx
        ON app_purchases (user_id)`,
      `CREATE TABLE IF NOT EXISTS app_json_imports (
        source TEXT PRIMARY KEY,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        inserted JSONB NOT NULL,
        skipped JSONB NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    name: 'rtdn_idempotency',
    statements: [
      `CREATE TABLE IF NOT EXISTS app_rtdn_events (
        message_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ],
  },
];

// Arbitrary constant used to serialise migrations across instances.
const MIGRATION_LOCK_KEY = 7348120931;

const MAX_WRITE_ATTEMPTS = 3;

// Errors that mean "database unreachable / restarting", not "bad data".
// SQLSTATE classes: 08 connection, 53 insufficient resources,
// 57P0x operator intervention (shutdown/restart), 40001/40P01 retryable.
function isTransientDbError(err: any): boolean {
  const code = String(err?.code || '');

  if (
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EHOSTUNREACH',
      '40001',
      '40P01',
    ].includes(code)
  ) {
    return true;
  }

  if (code.startsWith('08') || code.startsWith('53') || code.startsWith('57P')) {
    return true;
  }

  const message = String(err?.message || '');

  return /timeout|terminat|Connection|connect/i.test(message) && !/syntax|violat/i.test(message);
}

export class PostgresStore {
  private pool: InstanceType<typeof Pool>;

  private queue: Promise<void> =
    Promise.resolve();

  private pendingWrites = 0;

  private failedWrites = 0;

  private writeSeq = 0;

  private completedSeq = 0;

  private failedSeqs: number[] = [];

  private connectionDown = false;

  private closing = false;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.pool.on('error', (err: Error) => {
      console.error(
        '[DB] Idle PostgreSQL client error:',
        err.message
      );
    });
  }

  async connectAndMigrate(): Promise<void> {
    await this.migrate();
  }

  async migrate(): Promise<void> {
    const client =
      await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        'SELECT pg_advisory_xact_lock($1)',
        [MIGRATION_LOCK_KEY]
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      const appliedRes =
        await client.query(
          'SELECT version FROM schema_migrations'
        );

      const applied = new Set<number>(
        appliedRes.rows.map((r: any) =>
          Number(r.version)
        )
      );

      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) {
          continue;
        }

        for (const statement of migration.statements) {
          await client.query(statement);
        }

        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );

        console.log(
          `[DB] Applied migration ${migration.version} (${migration.name})`
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client
        .query('ROLLBACK')
        .catch(() => undefined);

      throw err;
    } finally {
      client.release();
    }
  }

  async loadAll(): Promise<LoadedData> {
    const [
      usersRes,
      sessionsRes,
      documentsRes,
      usageRes,
      purchasesRes,
      rtdnEventsRes,
    ] = await Promise.all([
      this.pool.query(
        'SELECT data FROM app_users ORDER BY created_at ASC'
      ),
      this.pool.query(
        'SELECT token_hash, user_id, created_at, expires_at FROM app_sessions'
      ),
      this.pool.query(
        'SELECT data FROM app_documents ORDER BY doc_timestamp DESC'
      ),
      this.pool.query(
        'SELECT usage_key, count FROM app_usage'
      ),
      this.pool.query(
        'SELECT data FROM app_purchases'
      ),
      this.pool.query(
        'SELECT data FROM app_rtdn_events'
      ),
    ]);

    const usage: Record<string, number> = {};

    for (const row of usageRes.rows) {
      usage[row.usage_key] = Number(row.count);
    }

    return {
      users: usersRes.rows.map((r: any) => r.data),
      sessions: sessionsRes.rows.map((r: any) => ({
        tokenHash: r.token_hash,
        userId: r.user_id,
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
      })),
      documents: documentsRes.rows.map((r: any) => r.data),
      usage,
      purchases: purchasesRes.rows.map((r: any) => r.data),
      rtdnEvents: rtdnEventsRes.rows.map((r: any) => r.data),
    };
  }

  /**
   * Imports legacy JSON data. Existing database rows are never
   * overwritten: conflicting rows are skipped and reported.
   * Each source is imported at most once.
   */
  async importJson(
    source: string,
    input: JsonImportInput
  ): Promise<JsonImportResult> {
    const client =
      await this.pool.connect();

    const inserted: Record<string, number> = {
      users: 0,
      sessions: 0,
      documents: 0,
      usage: 0,
      purchases: 0,
    };

    const skipped: Record<string, number> = {
      users: 0,
      sessions: 0,
      documents: 0,
      usage: 0,
      purchases: 0,
    };

    try {
      await client.query('BEGIN');

      await client.query(
        'SELECT pg_advisory_xact_lock($1)',
        [MIGRATION_LOCK_KEY]
      );

      const existing =
        await client.query(
          'SELECT 1 FROM app_json_imports WHERE source = $1',
          [source]
        );

      if (existing.rowCount && existing.rowCount > 0) {
        await client.query('ROLLBACK');

        return {
          alreadyImported: true,
          inserted,
          skipped,
        };
      }

      const count = (
        key: string,
        rowCount: number | null
      ) => {
        if (rowCount && rowCount > 0) {
          inserted[key] += 1;
        } else {
          skipped[key] += 1;
        }
      };

      for (const user of input.users) {
        if (!user?.id || !user?.email) {
          skipped.users += 1;
          continue;
        }

        const res = await client.query(
          `INSERT INTO app_users (id, email, data, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            user.id,
            user.email,
            JSON.stringify(user),
            Number(user.createdAt) || Date.now(),
          ]
        );

        if (!res.rowCount) {
          console.warn(
            `[DB] JSON import skipped user ${user.id}: a user with this id or email already exists.`
          );
        }

        count('users', res.rowCount);
      }

      for (const session of input.sessions) {
        if (!session?.tokenHash || !session?.userId) {
          skipped.sessions += 1;
          continue;
        }

        const res = await client.query(
          `INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            session.tokenHash,
            session.userId,
            Number(session.createdAt) || 0,
            Number(session.expiresAt) || 0,
          ]
        );

        count('sessions', res.rowCount);
      }

      for (const doc of input.documents) {
        if (!doc?.id || !doc?.userId) {
          skipped.documents += 1;
          continue;
        }

        const res = await client.query(
          `INSERT INTO app_documents (user_id, id, data, doc_timestamp)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            doc.userId,
            doc.id,
            JSON.stringify(doc),
            Number(doc.timestamp) || Date.now(),
          ]
        );

        if (!res.rowCount) {
          console.warn(
            `[DB] JSON import skipped document ${doc.id} for user ${doc.userId}: already exists.`
          );
        }

        count('documents', res.rowCount);
      }

      for (const [key, value] of Object.entries(input.usage)) {
        const res = await client.query(
          `INSERT INTO app_usage (usage_key, count)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [key, Number(value) || 0]
        );

        count('usage', res.rowCount);
      }

      for (const purchase of input.purchases) {
        if (
          !purchase?.purchaseToken ||
          !purchase?.id ||
          !purchase?.userId
        ) {
          skipped.purchases += 1;
          continue;
        }

        const res = await client.query(
          `INSERT INTO app_purchases (purchase_token, id, user_id, data)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            purchase.purchaseToken,
            purchase.id,
            purchase.userId,
            JSON.stringify(purchase),
          ]
        );

        if (!res.rowCount) {
          console.warn(
            `[DB] JSON import skipped purchase record ${purchase.id}: token already recorded.`
          );
        }

        count('purchases', res.rowCount);
      }

      await client.query(
        `INSERT INTO app_json_imports (source, inserted, skipped)
         VALUES ($1, $2, $3)`,
        [
          source,
          JSON.stringify(inserted),
          JSON.stringify(skipped),
        ]
      );

      await client.query('COMMIT');

      return {
        alreadyImported: false,
        inserted,
        skipped,
      };
    } catch (err) {
      await client
        .query('ROLLBACK')
        .catch(() => undefined);

      throw err;
    } finally {
      client.release();
    }
  }

  // -----------------------------------------------------------
  // ORDERED WRITE-THROUGH QUEUE
  // -----------------------------------------------------------
  //
  // Writes are applied strictly in order. Connection problems
  // (database restart, network outage) are retried until the database
  // is reachable again, so no change is dropped during an outage.
  // Errors caused by the data itself are retried a few times, then
  // recorded as failed so one bad row cannot block every later write.
  // Callers use writeMark()/waitForWrites() to confirm their change
  // reached PostgreSQL before telling the user it was saved.

  private enqueue(
    label: string,
    sql: string,
    params: unknown[]
  ): void {
    this.pendingWrites += 1;
    this.writeSeq += 1;
    const seq = this.writeSeq;

    this.queue = this.queue.then(async () => {
      let attempt = 0;

      while (true) {
        attempt += 1;

        try {
          await this.pool.query(sql, params);

          if (this.connectionDown) {
            this.connectionDown = false;
            console.log('[DB] PostgreSQL connection restored; pending writes resumed.');
          }

          return;
        } catch (err: any) {
          const transient = isTransientDbError(err);

          if (!transient && attempt >= MAX_WRITE_ATTEMPTS) {
            this.failedWrites += 1;
            this.failedSeqs.push(seq);

            if (this.failedSeqs.length > 1000) {
              this.failedSeqs.shift();
            }

            console.error(
              `[DB] Write failed permanently after ${attempt} attempts (${label}):`,
              err?.code || '',
              err?.message || err
            );

            return;
          }

          if (transient && !this.connectionDown) {
            this.connectionDown = true;
            console.error(
              `[DB] PostgreSQL unavailable (${label}); retrying until it recovers:`,
              err?.code || '',
              err?.message || err
            );
          }

          if (this.closing && transient && attempt >= MAX_WRITE_ATTEMPTS * 4) {
            // During shutdown give up eventually so the process can exit;
            // the loss is reported loudly.
            this.failedWrites += 1;
            this.failedSeqs.push(seq);
            console.error(`[DB] Write abandoned during shutdown (${label}).`);
            return;
          }

          const delay = Math.min(5000, 250 * 2 ** Math.min(attempt, 5));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }).finally(() => {
      this.pendingWrites -= 1;
      this.completedSeq = Math.max(this.completedSeq, seq);
    });
  }

  /** Sequence number of the most recently queued write. */
  writeMark(): number {
    return this.writeSeq;
  }

  /**
   * Waits until every write queued so far has been applied. Returns
   * false if any write queued after `sinceMark` failed, or if the
   * writes did not complete within the timeout (database outage).
   */
  async waitForWrites(
    sinceMark: number,
    timeoutMs = 10000
  ): Promise<boolean> {
    const target = this.writeSeq;

    if (target <= sinceMark) return true;

    const tail = this.queue;
    let timer: NodeJS.Timeout | undefined;

    const finished = await Promise.race([
      tail.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);

    if (timer) clearTimeout(timer);

    if (!finished && this.completedSeq < target) return false;

    return !this.failedSeqs.some((seq) => seq > sinceMark && seq <= target);
  }

  getStatus(): {
    pendingWrites: number;
    failedWrites: number;
    connected: boolean;
  } {
    return {
      pendingWrites: this.pendingWrites,
      failedWrites: this.failedWrites,
      connected: !this.connectionDown,
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async close(timeoutMs = 25000): Promise<void> {
    this.closing = true;

    let timer: NodeJS.Timeout | undefined;

    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.error(
            `[DB] Shutdown timeout: ${this.pendingWrites} write(s) still pending.`
          );
          resolve();
        }, timeoutMs);
      }),
    ]);

    if (timer) clearTimeout(timer);

    await this.pool.end().catch(() => undefined);
  }

  upsertUser(user: any): void {
    this.enqueue(
      `upsert user ${user.id}`,
      `INSERT INTO app_users (id, email, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             data = EXCLUDED.data,
             updated_at = now()`,
      [
        user.id,
        user.email,
        JSON.stringify(user),
        Number(user.createdAt) || Date.now(),
      ]
    );
  }

  deleteUser(userId: string): void {
    this.enqueue(
      `delete user ${userId}`,
      'DELETE FROM app_users WHERE id = $1',
      [userId]
    );
  }

  insertSession(session: PersistedSession): void {
    this.enqueue(
      `insert session for ${session.userId}`,
      `INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_hash) DO NOTHING`,
      [
        session.tokenHash,
        session.userId,
        session.createdAt,
        session.expiresAt,
      ]
    );
  }

  upsertSession(session: PersistedSession): void {
    this.insertSession(session);
  }

  deleteSession(tokenHash: string): void {
    this.enqueue(
      'delete session',
      'DELETE FROM app_sessions WHERE token_hash = $1',
      [tokenHash]
    );
  }

  deleteExpiredSessionsForUser(
    userId: string,
    now: number
  ): void {
    this.enqueue(
      `delete expired sessions for ${userId}`,
      'DELETE FROM app_sessions WHERE user_id = $1 AND expires_at <= $2',
      [userId, now]
    );
  }

  deleteSessionsForUser(userId: string): void {
    this.enqueue(
      `delete sessions for ${userId}`,
      'DELETE FROM app_sessions WHERE user_id = $1',
      [userId]
    );
  }

  upsertDocument(doc: any): void {
    this.enqueue(
      `upsert document ${doc.id}`,
      `INSERT INTO app_documents (user_id, id, data, doc_timestamp, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, id) DO UPDATE
         SET data = EXCLUDED.data,
             doc_timestamp = EXCLUDED.doc_timestamp,
             updated_at = now()`,
      [
        doc.userId,
        doc.id,
        JSON.stringify(doc),
        Number(doc.timestamp) || Date.now(),
      ]
    );
  }

  deleteDocument(
    userId: string,
    docId: string
  ): void {
    this.enqueue(
      `delete document ${docId}`,
      'DELETE FROM app_documents WHERE user_id = $1 AND id = $2',
      [userId, docId]
    );
  }

  deleteDocumentsForUser(userId: string): void {
    this.enqueue(
      `delete documents for ${userId}`,
      'DELETE FROM app_documents WHERE user_id = $1',
      [userId]
    );
  }

  upsertUsage(
    key: string,
    count: number
  ): void {
    this.enqueue(
      `upsert usage ${key}`,
      `INSERT INTO app_usage (usage_key, count, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (usage_key) DO UPDATE
         SET count = EXCLUDED.count,
             updated_at = now()`,
      [key, count]
    );
  }

  upsertPurchase(record: any): void {
    this.enqueue(
      `upsert purchase ${record.id}`,
      `INSERT INTO app_purchases (purchase_token, id, user_id, data, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (purchase_token) DO UPDATE
         SET data = EXCLUDED.data,
             updated_at = now()
         WHERE app_purchases.user_id = EXCLUDED.user_id`,
      [
        record.purchaseToken,
        record.id,
        record.userId,
        JSON.stringify(record),
      ]
    );
  }

  upsertRtdnEvent(record: any): void {
    this.enqueue(
      `upsert rtdn event ${record.messageId}`,
      `INSERT INTO app_rtdn_events (message_id, data, created_at)
       VALUES ($1, $2, now())
       ON CONFLICT (message_id) DO NOTHING`,
      [
        record.messageId,
        JSON.stringify(record),
      ]
    );
  }
}
