// One-off import of legacy JSON backups into PostgreSQL.
//
// Usage:
//   DATABASE_URL=... npx tsx server/importJsonToPostgres.ts /path/to/backup-dir
//
// The directory may contain any of: users.json, sessions.json,
// documents.json, usage.json, purchases.json.
//
// Safety guarantees:
// - Schema migrations are applied first (non-destructive).
// - Existing database rows are NEVER overwritten; conflicting rows
//   are skipped and reported.
// - Source JSON files are only read, never modified or deleted.
// - The same source directory is imported at most once.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PostgresStore } from './db.ts';

dotenv.config();

function readJson(filePath: string, fallback: unknown): unknown {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  // Throws on invalid JSON so a damaged backup is never half-imported.
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function hashToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

async function main(): Promise<void> {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();

  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const sourceDir = path.resolve(
    process.argv[2] || path.join(process.cwd(), 'data')
  );

  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  const rawUsers = readJson(path.join(sourceDir, 'users.json'), []);
  const rawSessions = readJson(path.join(sourceDir, 'sessions.json'), []);
  const rawDocuments = readJson(path.join(sourceDir, 'documents.json'), []);
  const rawUsage = readJson(path.join(sourceDir, 'usage.json'), {});
  const rawPurchases = readJson(path.join(sourceDir, 'purchases.json'), []);

  const sessions = (Array.isArray(rawSessions) ? rawSessions : [])
    .map((s: any) => {
      const tokenHash =
        typeof s?.tokenHash === 'string'
          ? s.tokenHash
          : typeof s?.token === 'string' && s.token
            ? hashToken(s.token)
            : null;

      if (!tokenHash || typeof s?.userId !== 'string') {
        return null;
      }

      return {
        tokenHash,
        userId: s.userId,
        createdAt: Number(s.createdAt) || 0,
        expiresAt: Number(s.expiresAt) || 0,
      };
    })
    .filter(Boolean) as any[];

  const store = new PostgresStore(databaseUrl);

  try {
    await store.migrate();

    const result = await store.importJson(
      `cli:${sourceDir}`,
      {
        users: Array.isArray(rawUsers) ? rawUsers : [],
        sessions,
        documents: Array.isArray(rawDocuments) ? rawDocuments : [],
        usage:
          rawUsage && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
            ? (rawUsage as Record<string, number>)
            : {},
        purchases: Array.isArray(rawPurchases) ? rawPurchases : [],
      }
    );

    if (result.alreadyImported) {
      console.log(`Source ${sourceDir} was already imported. Nothing to do.`);
    } else {
      console.log('Import complete.');
      console.log('Inserted:', result.inserted);
      console.log('Skipped (already present or invalid):', result.skipped);
    }
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error('Import failed; no partial data was committed.', err?.message || err);
  process.exit(1);
});
