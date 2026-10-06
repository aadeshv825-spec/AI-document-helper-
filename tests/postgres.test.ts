import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { startTestServer, api, registerUser, freePort, type TestServer } from './helpers.ts';
import { PostgresStore } from '../server/db.ts';

const BASE_URL = process.env.TEST_DATABASE_URL || '';
const skip = !BASE_URL ? 'TEST_DATABASE_URL not set (PostgreSQL not available)' : false;

let dbName = '';
let dbUrl = '';

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

before(async () => {
  if (skip) return;
  dbName = `adh_test_${Date.now()}`;
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  dbUrl = withDatabase(BASE_URL, dbName);
});

after(async () => {
  if (skip || !dbName) return;
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function query(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

test('REQUIRE_DATABASE=true refuses to start without DATABASE_URL', { skip: false }, async () => {
  const s = await startTestServer({ REQUIRE_DATABASE: 'true', NODE_ENV: 'production' }, { expectFailure: true });
  assert.notEqual((s as any).exitCode, 0);
  assert.notEqual((s as any).exitCode, null, 'server must exit, not keep running');
  assert.match(s.logs(), /REQUIRE_DATABASE=true but DATABASE_URL is not set/);
});

test('migrations, persistence across restart, sessions and password changes', { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-pg-'));
  let server: TestServer = await startTestServer({ DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true' }, { dataDir });

  const migrations = await query('SELECT version FROM schema_migrations ORDER BY version');
  assert.ok(migrations.rowCount! >= 1);

  const u = await registerUser(server);
  const doc = await api(server, 'POST', '/api/documents', { title: 'Persist me', type: 'pdf-summary', fullContent: 'persisted-content-123', isFavorite: true }, u.token);
  assert.equal(doc.status, 200);

  const changed = await api(server, 'POST', '/api/auth/change-password', { currentPassword: u.password, newPassword: 'after-restart-pass-1' }, u.token);
  assert.equal(changed.status, 200);

  // Concurrent writes.
  const many = await Promise.all(
    Array.from({ length: 30 }, (_, i) => api(server, 'POST', '/api/documents', { title: `Doc ${i}`, type: 'ai-writer', fullContent: `concurrent-${i}` }, changed.data.token))
  );
  assert.deepEqual([...new Set(many.map((r) => r.status))], [200]);

  const exitCode = await server.stop('SIGTERM');
  assert.equal(exitCode, 0, 'graceful shutdown flushes writes and exits cleanly');

  server = await startTestServer({ DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true' }, { dataDir });
  try {
    assert.equal((await api(server, 'GET', '/api/auth/me', undefined, u.token)).data.authenticated, false, 'revoked session stays revoked');
    assert.equal((await api(server, 'POST', '/api/auth/login', { email: u.email, password: u.password })).status, 401);

    const login = await api(server, 'POST', '/api/auth/login', { email: u.email, password: 'after-restart-pass-1' });
    assert.equal(login.status, 200);

    const docs = await api(server, 'GET', '/api/documents', undefined, login.data.token);
    const text = JSON.stringify(docs.data);
    assert.ok(text.includes('persisted-content-123'));
    for (let i = 0; i < 30; i += 1) assert.ok(text.includes(`concurrent-${i}`), `missing concurrent-${i}`);

    const rows = await query('SELECT count(*)::int AS n FROM app_documents WHERE user_id = $1', [u.user.id]);
    assert.equal(rows.rows[0].n, 31);

    const stored = await query('SELECT data FROM app_users WHERE id = $1', [u.user.id]);
    assert.ok(!JSON.stringify(stored.rows[0].data).includes('after-restart-pass-1'), 'no plaintext password in DB');
  } finally {
    await server.stop();
  }
});

test('legacy JSON import is idempotent and never overwrites database rows', { skip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-import-'));
  const now = Date.now();
  const legacyUsers = [
    { id: `legacy_${now}`, email: `legacy${now}@example.com`, name: 'Legacy', passwordHash: 'x'.repeat(128), salt: 'y'.repeat(32), plan: 'free', createdAt: now },
  ];
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(legacyUsers));
  fs.writeFileSync(path.join(dataDir, 'documents.json'), JSON.stringify([{ id: 'd1', userId: legacyUsers[0].id, title: 'Legacy doc', type: 'pdf-summary', fullContent: 'legacy-content', timestamp: now }]));

  for (let run = 0; run < 2; run += 1) {
    const s = await startTestServer({ DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true' }, { dataDir });
    await s.stop();
  }

  const users = await query('SELECT count(*)::int AS n FROM app_users WHERE id = $1', [legacyUsers[0].id]);
  assert.equal(users.rows[0].n, 1);
  const docs = await query('SELECT count(*)::int AS n FROM app_documents WHERE user_id = $1', [legacyUsers[0].id]);
  assert.equal(docs.rows[0].n, 1);
  const imports = await query('SELECT count(*)::int AS n FROM app_json_imports');
  assert.equal(imports.rows[0].n, 1, 'each source imported once');

  // JSON files are left untouched (backup preserved).
  assert.ok(fs.existsSync(path.join(dataDir, 'users.json')));
});

// TCP proxy that can simulate a database outage.
async function startProxy(targetUrl: string) {
  const target = new URL(targetUrl);
  const sockets = new Set<net.Socket>();
  let down = false;
  const port = await freePort();
  const server = net.createServer((client) => {
    if (down) return client.destroy();
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    const cleanup = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', cleanup);
    upstream.on('error', cleanup);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  const url = new URL(targetUrl);
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return {
    url: url.toString(),
    setDown(value: boolean) {
      down = value;
      if (value) for (const s of sockets) s.destroy();
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('database outage: saves are not reported as successful; queued writes apply after recovery', { skip }, async () => {
  const proxy = await startProxy(dbUrl);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-outage-'));
  const server = await startTestServer({ DATABASE_URL: proxy.url, REQUIRE_DATABASE: 'true' }, { dataDir });

  try {
    const u = await registerUser(server);

    proxy.setDown(true);

    const during = await api(server, 'POST', '/api/documents', { title: 'During outage', type: 'ai-writer', fullContent: 'outage-content-777' }, u.token);
    assert.equal(during.status, 503, 'must not claim success while the database is down');
    assert.equal(during.data.persistenceFailed, true);

    const health = await api(server, 'GET', '/api/health');
    assert.equal(health.data.storage.connected, false);
    assert.equal((await api(server, 'GET', '/api/health/ready')).status, 503);

    proxy.setDown(false);

    // Wait for the queued write to be applied.
    const deadline = Date.now() + 20000;
    let applied = false;
    while (Date.now() < deadline) {
      const r = await query("SELECT 1 FROM app_documents WHERE user_id = $1 AND data->>'fullContent' = 'outage-content-777'", [u.user.id]);
      if (r.rowCount) {
        applied = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    assert.equal(applied, true, 'write queued during the outage is applied after recovery');

    const after = await api(server, 'POST', '/api/documents', { title: 'After', type: 'ai-writer', fullContent: 'after-recovery' }, u.token);
    assert.equal(after.status, 200);
    assert.equal((await api(server, 'GET', '/api/health')).data.storage.connected, true);
  } finally {
    await server.stop();
    await proxy.close();
  }
});
