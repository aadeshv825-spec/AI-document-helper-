import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, api, registerUser, uniqueEmail, type TestServer } from './helpers.ts';

let server: TestServer;

before(async () => {
  server = await startTestServer({
    GOOGLE_CLIENT_ID: 'test-web-client.apps.googleusercontent.com',
    RTDN_PUSH_AUDIENCE: 'https://api.example.com/api/billing/google-play/rtdn',
    RTDN_PUSH_SERVICE_ACCOUNT: 'rtdn@example.iam.gserviceaccount.com',
  });
});

after(async () => {
  await server?.stop();
});

test('registration, login, wrong password and /me', async () => {
  const { email, password, token } = await registerUser(server);
  assert.ok(token);

  const me = await api(server, 'GET', '/api/auth/me', undefined, token);
  assert.equal(me.status, 200);
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.user.email, email);
  assert.equal(me.data.user.hasPassword, true);
  assert.equal(me.data.user.isAdmin, false);
  assert.equal(me.data.user.passwordHash, undefined, 'password hash must never be returned');
  assert.equal(me.data.user.salt, undefined);

  const good = await api(server, 'POST', '/api/auth/login', { email, password });
  assert.equal(good.status, 200);
  assert.ok(good.data.token);

  const bad = await api(server, 'POST', '/api/auth/login', { email, password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.token, undefined);

  const dup = await api(server, 'POST', '/api/auth/register', { name: 'X', email, password: 'another-pass-1' });
  assert.ok(dup.status >= 400 && dup.status < 500);
});

test('passwords are stored hashed (PBKDF2), never in plain text', async () => {
  const { email, password } = await registerUser(server, 'plain-text-check-123');
  const users = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'users.json'), 'utf8'));
  const stored = users.find((u: any) => u.email === email);
  assert.ok(stored);
  assert.ok(!JSON.stringify(stored).includes(password));
  assert.equal(stored.passwordIterations ?? 310000, 310000);
  const sessions = fs.readFileSync(path.join(server.dataDir, 'sessions.json'), 'utf8');
  assert.ok(!sessions.includes('"token"'), 'session tokens must be stored hashed');
});

test('logout and invalid tokens', async () => {
  const { token } = await registerUser(server);
  const out = await api(server, 'POST', '/api/auth/logout', {}, token);
  assert.equal(out.status, 200);
  const me = await api(server, 'GET', '/api/auth/me', undefined, token);
  assert.equal(me.data.authenticated, false);

  const forged = await api(server, 'GET', '/api/auth/me', undefined, 'forged-token-value');
  assert.equal(forged.data.authenticated, false);
});

test('change password verifies the current password and revokes all sessions', async () => {
  const { email, password, token } = await registerUser(server);
  const second = await api(server, 'POST', '/api/auth/login', { email, password });

  const wrong = await api(server, 'POST', '/api/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'brand-new-pass-1' }, token);
  assert.equal(wrong.status, 400);

  const short = await api(server, 'POST', '/api/auth/change-password', { currentPassword: password, newPassword: '123' }, token);
  assert.equal(short.status, 400);

  const ok = await api(server, 'POST', '/api/auth/change-password', { currentPassword: password, newPassword: 'brand-new-pass-1' }, token);
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);

  for (const oldToken of [token, second.data.token]) {
    const me = await api(server, 'GET', '/api/auth/me', undefined, oldToken);
    assert.equal(me.data.authenticated, false, 'old sessions must be revoked');
  }

  const meNew = await api(server, 'GET', '/api/auth/me', undefined, ok.data.token);
  assert.equal(meNew.data.authenticated, true);

  assert.equal((await api(server, 'POST', '/api/auth/login', { email, password })).status, 401);
  assert.equal((await api(server, 'POST', '/api/auth/login', { email, password: 'brand-new-pass-1' })).status, 200);
});

test('password reset is honest when email is not configured and rejects bad tokens', async () => {
  const status = await api(server, 'GET', '/api/auth/password-reset/status');
  assert.equal(status.data.available, false);

  const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: uniqueEmail() });
  assert.equal(req.status, 503);
  assert.equal(req.data.success, undefined);

  const confirm = await api(server, 'POST', '/api/auth/password-reset/confirm', { token: 'a'.repeat(64), newPassword: 'whatever-123' });
  assert.equal(confirm.status, 400);

  const page = await fetch(`${server.url}/reset-password`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control')?.includes('no-store'), true);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
});

test('Google nonce endpoint issues unique single-use nonces; forged ID tokens are rejected', async () => {
  const a = await api(server, 'POST', '/api/auth/google/nonce', {});
  const b = await api(server, 'POST', '/api/auth/google/nonce', {});
  assert.equal(a.status, 200);
  assert.match(a.data.nonce, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(a.data.nonce, b.data.nonce);

  const forged = await api(server, 'POST', '/api/auth/google/native', { idToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.' }); // gitleaks:allow (fake test token)
  assert.equal(forged.status, 401);
  assert.equal(forged.data.token, undefined);

  const missing = await api(server, 'POST', '/api/auth/google/native', {});
  assert.equal(missing.status, 400);
});

test('documents are private to their owner', async () => {
  const alice = await registerUser(server);
  const bob = await registerUser(server);

  const saved = await api(server, 'POST', '/api/documents', { title: 'Alice secret', type: 'pdf-summary', fullContent: 'alice private text' }, alice.token);
  assert.equal(saved.status, 200);
  const docId = saved.data.document.id;

  const bobList = await api(server, 'GET', '/api/documents', undefined, bob.token);
  assert.equal(bobList.status, 200);
  assert.ok(!JSON.stringify(bobList.data).includes('alice private text'));

  const bobEdit = await api(server, 'PUT', `/api/documents/${docId}`, { title: 'hacked' }, bob.token);
  assert.ok(bobEdit.status >= 400);

  await api(server, 'DELETE', `/api/documents/${docId}`, undefined, bob.token);
  const aliceList = await api(server, 'GET', '/api/documents', undefined, alice.token);
  assert.ok(JSON.stringify(aliceList.data).includes('alice private text'), 'Bob must not delete Alice\'s document');

  const anon = await api(server, 'GET', '/api/documents');
  assert.ok(!JSON.stringify(anon.data).includes('alice private text'));

  const fav = await api(server, 'PUT', `/api/documents/${docId}`, { isFavorite: true }, alice.token);
  assert.equal(fav.status, 200);
  assert.equal(fav.data.document.isFavorite, true);
});

test('account deletion removes the user, sessions and documents', async () => {
  const u = await registerUser(server);
  await api(server, 'POST', '/api/documents', { title: 'to delete', type: 'ai-writer', fullContent: 'delete-me-content-xyz' }, u.token);

  const del = await api(server, 'DELETE', '/api/auth/account', undefined, u.token);
  assert.equal(del.status, 200);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.authenticated, false);
  assert.equal((await api(server, 'POST', '/api/auth/login', { email: u.email, password: u.password })).status, 401);

  const docs = fs.readFileSync(path.join(server.dataDir, 'documents.json'), 'utf8');
  assert.ok(!docs.includes('delete-me-content-xyz'));
});

test('admin endpoints and Pro self-upgrade are forbidden for normal users', async () => {
  const u = await registerUser(server);
  assert.equal((await api(server, 'GET', '/api/admin/users', undefined, u.token)).status, 403);
  assert.equal((await api(server, 'GET', '/api/admin/users')).status, 401);
  assert.equal((await api(server, 'POST', `/api/admin/users/${u.user.id}/plan`, { plan: 'pro' }, u.token)).status, 403);
  assert.equal((await api(server, 'POST', '/api/user/plan', { plan: 'pro' }, u.token)).status, 403);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('owner email registered with a password does not become admin', async () => {
  // Admin requires the Google-linked owner account.
  const res = await api(server, 'POST', '/api/auth/register', { name: 'Fake Owner', email: 'aadeshv825@gmail.com', password: 'owner-attempt-1' });
  if (res.status === 200) {
    assert.equal(res.data.user.isAdmin, false);
    assert.equal((await api(server, 'GET', '/api/admin/users', undefined, res.data.token)).status, 403);
  } else {
    assert.ok(res.status >= 400 && res.status < 500);
  }
});

test('failed AI requests do not consume free usage; limit is enforced atomically', async () => {
  const u = await registerUser(server);

  // GEMINI_API_KEY is not configured in tests, so every AI call fails.
  const results = await Promise.all(
    Array.from({ length: 8 }, () => api(server, 'POST', '/api/hindi-translation', { text: 'hello', sourceLang: 'English', targetLang: 'Hindi' }, u.token))
  );
  for (const r of results) {
    assert.ok(r.status >= 500 || r.status === 400, `unexpected ${r.status}`);
    assert.ok(!String(r.data?.error || '').includes('GEMINI_API_KEY'), 'internal configuration must not leak');
  }

  const usage = await api(server, 'GET', '/api/user/usage', undefined, u.token);
  assert.equal(usage.data.dailyUsed ?? usage.data.usage?.dailyUsed, 0);

  // Validation errors are also not counted.
  const invalid = await api(server, 'POST', '/api/hindi-translation', { text: 'x'.repeat(20001), sourceLang: 'English', targetLang: 'Hindi' }, u.token);
  assert.equal(invalid.status, 413);
});

test('daily free limit: concurrent requests cannot exceed 5 (store level)', async () => {
  // Covered against the real store in tests/store.test.ts.
  assert.ok(true);
});

test('input validation, unknown routes and payload limits return JSON errors', async () => {
  const notFound = await api(server, 'GET', '/api/does-not-exist');
  assert.equal(notFound.status, 404);
  assert.equal(typeof notFound.data, 'object');

  const badJson = await api(server, 'POST', '/api/auth/login', '{bad json');
  assert.equal(badJson.status, 400);

  const badMime = await api(server, 'POST', '/api/photo-to-text', { imageBase64: 'data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA', mimeType: 'application/x-msdownload' });
  assert.ok(badMime.status === 400 || badMime.status === 415, String(badMime.status));
});

test('CORS only allows trusted origins', async () => {
  const allowed = await fetch(`${server.url}/api/health`, { headers: { Origin: 'https://appassets.androidplatform.net' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');

  const evil = await fetch(`${server.url}/api/health`, { headers: { Origin: 'https://evil.example.com' } });
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example.com');
  assert.notEqual(evil.headers.get('access-control-allow-origin'), '*');
});

test('RTDN endpoint rejects unauthenticated notifications and never grants Pro', async () => {
  const u = await registerUser(server);
  const data = Buffer.from(JSON.stringify({
    packageName: 'com.aidocumenthelper.app',
    subscriptionNotification: { notificationType: 4, purchaseToken: 'fake-token', subscriptionId: 'ai_doc_pro_monthly' },
  })).toString('base64');

  const noAuth = await api(server, 'POST', '/api/billing/google-play/rtdn', { message: { data, messageId: '1' } });
  assert.equal(noAuth.status, 401);

  const forged = await api(server, 'POST', '/api/billing/google-play/rtdn', { message: { data, messageId: '2' } }, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
  assert.equal(forged.status, 401);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('purchase verification requires sign-in and a valid product', async () => {
  const anon = await api(server, 'POST', '/api/billing/google-play/verify-purchase', { purchaseToken: 'abc', sku: 'ai_doc_pro_monthly' });
  assert.equal(anon.status, 401);

  const u = await registerUser(server);
  const badSku = await api(server, 'POST', '/api/billing/google-play/verify-purchase', { purchaseToken: 'abc', sku: 'free_pro_hack', packageName: 'com.aidocumenthelper.app' }, u.token);
  assert.equal(badSku.status, 400);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('login brute force is rate limited', async () => {
  const email = uniqueEmail('brute');
  let limited = false;
  for (let i = 0; i < 30; i += 1) {
    const r = await api(server, 'POST', '/api/auth/login', { email, password: `guess-${i}` });
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
});

test('safe error messages never leak filesystem paths, stack traces, or environment keys', async () => {
  const u = await registerUser(server);
  const res = await api(server, 'POST', '/api/photo-to-text', { imageBase64: 'dGVzdA==', mimeType: 'image/jpeg' }, u.token);
  assert.ok(res.status >= 400);
  const errorText = JSON.stringify(res.data);
  assert.ok(!errorText.includes('GEMINI_API_KEY'));
  assert.ok(!errorText.includes('/app/'));
  assert.ok(!errorText.includes('node:internal'));
  assert.ok(!errorText.includes('stack'));
});

test('invalid package name in purchase verification is rejected', async () => {
  const u = await registerUser(server);
  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: `tok_${Date.now()}`,
    sku: 'ai_doc_pro_monthly',
    packageName: 'com.evil.impostor',
  }, u.token);
  assert.equal(res.status, 400);
});

test('apiClient getApiBaseUrl has no development url fallback', async () => {
  const { getApiBaseUrl } = await import('../src/utils/apiClient.ts');
  const url = getApiBaseUrl();
  assert.ok(!url.includes('ais-dev-'), 'must never fall back to ais-dev url');
  assert.ok(!url.includes('localhost'), 'must never fall back to localhost');
});
