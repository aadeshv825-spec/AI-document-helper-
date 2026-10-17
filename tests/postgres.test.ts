import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { startTestServer, api, registerUser, freePort, startMockResend, extractResetToken, type TestServer } from './helpers.ts';
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
  const imports = await query('SELECT count(*)::int AS n FROM app_json_imports WHERE source = $1', [path.resolve(dataDir)]);
  assert.equal(imports.rows[0].n, 1, 'each source imported exactly once without duplicate records');

  // JSON files are left untouched (backup preserved).
  assert.ok(fs.existsSync(path.join(dataDir, 'users.json')));
});

// TCP proxy that can simulate a database outage.
async function startProxy(targetUrl: string) {
  const target = new URL(targetUrl);
  const sockets = new Set<net.Socket>();
  let down = false;
  let paused = false;
  const port = await freePort();
  const server = net.createServer((client) => {
    if (down) return client.destroy();
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    if (paused) {
      client.pause();
      upstream.pause();
    }
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
    // Hold bytes in both directions without closing sockets, so in-flight
    // queries hang and queued writes stay pending. `resume()` lets them flow.
    pause() {
      paused = true;
      for (const s of sockets) s.pause();
    },
    resume() {
      paused = false;
      for (const s of sockets) s.resume();
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
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

    const duringSync = await api(server, 'POST', '/api/documents/sync', { documents: [{ id: 'sync_outage_1', title: 'Sync Outage', type: 'scanner', snippet: 'outage', fullContent: 'outage-sync-content-888', timestamp: Date.now() }] }, u.token);
    assert.equal(duringSync.status, 503, 'sync must not claim success while the database is down');
    assert.equal(duringSync.data.persistenceFailed, true);

    const health = await api(server, 'GET', '/api/health');
    assert.equal(health.data.storage.connected, false);
    assert.equal((await api(server, 'GET', '/api/health/ready')).status, 503);

    proxy.setDown(false);

    // Wait for the queued writes to be applied.
    const deadline = Date.now() + 20000;
    let applied = false;
    let syncApplied = false;
    while (Date.now() < deadline) {
      if (!applied) {
        const r = await query("SELECT 1 FROM app_documents WHERE user_id = $1 AND data->>'fullContent' = 'outage-content-777'", [u.user.id]);
        if (r.rowCount) applied = true;
      }
      if (!syncApplied) {
        const rSync = await query("SELECT 1 FROM app_documents WHERE user_id = $1 AND id = 'sync_outage_1'", [u.user.id]);
        if (rSync.rowCount) syncApplied = true;
      }
      if (applied && syncApplied) break;
      await new Promise((res) => setTimeout(res, 300));
    }
    assert.equal(applied, true, 'write queued during the outage is applied after recovery');
    assert.equal(syncApplied, true, 'sync queued during the outage is applied after recovery');

    const after = await api(server, 'POST', '/api/documents', { title: 'After', type: 'ai-writer', fullContent: 'after-recovery' }, u.token);
    assert.equal(after.status, 200);
    assert.equal((await api(server, 'GET', '/api/health')).data.storage.connected, true);
  } finally {
    await server.stop();
    await proxy.close();
  }
});

test('graceful shutdown flushes in-flight pending writes before exiting', { skip, timeout: 60000 }, async () => {
  // Route the database through a proxy we can hold, so writes stay queued and
  // genuinely in flight when the shutdown signal arrives.
  const proxy = await startProxy(dbUrl);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-shutdown-'));
  const server = await startTestServer({ DATABASE_URL: proxy.url, REQUIRE_DATABASE: 'true' }, { dataDir });

  try {
    const u = await registerUser(server);

    // Hold database traffic so the writes cannot complete yet.
    proxy.pause();

    // Baseline of writes already queued (for example by registration) that are
    // now held too, so the wait below is measured against our own 15 writes.
    const baseline = (await api(server, 'GET', '/api/health')).data?.storage?.pendingWrites ?? 0;

    const titles = Array.from({ length: 15 }, (_, i) => `Inflight ${i}`);
    const writePromises = titles.map((title, i) => {
      const promise = api(server, 'POST', '/api/documents', { title, type: 'ai-writer', fullContent: `inflight-content-${i}` }, u.token);
      // Attach a rejection handler immediately: if the server closes the socket
      // before the response arrives, an unhandled rejection would fail the run
      // instead of being collected by allSettled() below.
      promise.catch(() => {});
      return promise;
    });

    // Wait until every request has actually reached the server and been queued as
    // a pending write. The database is held and the write queue is ordered, so
    // storage.pendingWrites climbs to 15 and stays there.
    const deadline = Date.now() + 20000;
    let pending = 0;
    while (Date.now() < deadline) {
      const health = await api(server, 'GET', '/api/health');
      pending = health.data?.storage?.pendingWrites ?? 0;
      if (pending >= baseline + titles.length) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(
      pending >= baseline + titles.length,
      `all ${titles.length} in-flight writes reached the server and are queued (pending=${pending}, baseline=${baseline})`
    );

    // Release the database and immediately request a graceful shutdown: the
    // server must flush every queued write before exiting.
    proxy.resume();
    const exitCode = await server.stop('SIGTERM');
    assert.equal(exitCode, 0, 'server exits with code 0 on successful flush');

    // Collect responses/rejections (some requests may have completed or been
    // aborted on the closed socket).
    await Promise.allSettled(writePromises);

    // Directly query PostgreSQL to verify all documents were durably written.
    const rows = await query('SELECT count(*)::int AS n FROM app_documents WHERE user_id = $1', [u.user.id]);
    assert.equal(rows.rows[0].n, 15, 'all in-flight writes were successfully flushed to PostgreSQL');
  } finally {
    proxy.resume();
    await server.stop();
    await proxy.close();
  }
});

// ---------------------------------------------------------------------------
// Persistent (PostgreSQL-backed) password-reset tokens
// ---------------------------------------------------------------------------

const RESET_ENV_BASE = {
  APP_URL: 'https://app.example.test',
  RESEND_API_KEY: 'test-resend-key',
  PASSWORD_RESET_EMAIL_FROM: 'AI Document Helper <no-reply@example.test>',
};

test('reset tokens are stored in PostgreSQL: they survive a restart and are single-use', { skip, timeout: 60000 }, async () => {
  const mock = await startMockResend();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-pr-pg-'));
  const env = { DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true', ...RESET_ENV_BASE, RESEND_API_URL: mock.url };
  let server = await startTestServer(env, { dataDir });
  try {
    const u = await registerUser(server, 'original-pass-1');

    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: u.email });
    assert.equal(req.status, 200);
    assert.equal(mock.state.calls, 1);
    const token = extractResetToken(mock.state.lastBody);
    assert.ok(token && token.length >= 32, 'a reset token was delivered');

    const stored = await query('SELECT count(*)::int AS n FROM app_password_resets WHERE user_id = $1', [u.user.id]);
    assert.equal(stored.rows[0].n, 1, 'the reset token is persisted in PostgreSQL');

    // Restart the server: the token must still work, which proves it lives in the
    // database rather than in process memory.
    await server.stop('SIGTERM');
    server = await startTestServer(env, { dataDir });

    const ok = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'reset-pass-2' });
    assert.equal(ok.status, 200);

    const reuse = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'reset-pass-3' });
    assert.equal(reuse.status, 400, 'a consumed token cannot be reused');

    const left = await query('SELECT count(*)::int AS n FROM app_password_resets WHERE user_id = $1', [u.user.id]);
    assert.equal(left.rows[0].n, 0, 'the consumed token is removed from the database');

    assert.equal((await api(server, 'POST', '/api/auth/login', { email: u.email, password: 'reset-pass-2' })).status, 200);
    assert.equal((await api(server, 'POST', '/api/auth/login', { email: u.email, password: 'original-pass-1' })).status, 401);
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('invalid and expired reset tokens are rejected and removed', { skip, timeout: 60000 }, async () => {
  const mock = await startMockResend();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-pr-exp-'));
  const env = { DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true', ...RESET_ENV_BASE, RESEND_API_URL: mock.url, PASSWORD_RESET_TTL_MS: '200' };
  const server = await startTestServer(env, { dataDir });
  try {
    const u = await registerUser(server, 'correct-horse-1');

    const invalid = await api(server, 'POST', '/api/auth/password-reset/confirm', { token: 'a'.repeat(64), newPassword: 'whatever-123' });
    assert.equal(invalid.status, 400, 'an unknown token is rejected');

    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: u.email });
    assert.equal(req.status, 200);
    const token = extractResetToken(mock.state.lastBody);
    assert.ok(token);

    await new Promise((r) => setTimeout(r, 500));

    const expired = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'expired-pass-1' });
    assert.equal(expired.status, 400, 'an expired token is rejected');
    assert.equal((await api(server, 'POST', '/api/auth/login', { email: u.email, password: 'correct-horse-1' })).status, 200);

    const left = await query('SELECT count(*)::int AS n FROM app_password_resets WHERE user_id = $1', [u.user.id]);
    assert.equal(left.rows[0].n, 0, 'the expired token is removed, so it cannot be replayed');
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('a too-short password is rejected without consuming the reset token', { skip, timeout: 60000 }, async () => {
  const mock = await startMockResend();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-pr-short-'));
  const env = { DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true', ...RESET_ENV_BASE, RESEND_API_URL: mock.url };
  const server = await startTestServer(env, { dataDir });
  try {
    const u = await registerUser(server, 'original-pass-1');
    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: u.email });
    assert.equal(req.status, 200);
    const token = extractResetToken(mock.state.lastBody);
    assert.ok(token);

    const short = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: '123' });
    assert.equal(short.status, 400);

    // Validation runs before consumption, so the token is still usable.
    const ok = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'good-pass-1' });
    assert.equal(ok.status, 200);
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('concurrent reset confirmations allow exactly one success', { skip, timeout: 60000 }, async () => {
  const mock = await startMockResend();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-pr-conc-'));
  const env = { DATABASE_URL: dbUrl, REQUIRE_DATABASE: 'true', ...RESET_ENV_BASE, RESEND_API_URL: mock.url };
  const server = await startTestServer(env, { dataDir });
  try {
    const u = await registerUser(server, 'original-pass-1');
    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: u.email });
    assert.equal(req.status, 200);
    const token = extractResetToken(mock.state.lastBody);
    assert.ok(token);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: `race-pass-${i}` }))
    );
    assert.equal(attempts.filter((r) => r.status === 200).length, 1, 'exactly one concurrent confirmation succeeds');
    assert.equal(attempts.filter((r) => r.status === 400).length, 7, 'all other concurrent confirmations are rejected');

    let accepted = 0;
    for (let i = 0; i < 8; i += 1) {
      if ((await api(server, 'POST', '/api/auth/login', { email: u.email, password: `race-pass-${i}` })).status === 200) accepted += 1;
    }
    assert.equal(accepted, 1, 'exactly one new password takes effect');
  } finally {
    await server.stop();
    await mock.close();
  }
});
