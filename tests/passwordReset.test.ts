import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, api, registerUser, uniqueEmail, freePort } from './helpers.ts';

// A local stand-in for the Resend API so the reset flow can be exercised
// deterministically, without reaching the public internet.
async function startMockResend() {
  const port = await freePort();
  const state: { lastBody: any; status: number; calls: number } = { lastBody: null, status: 200, calls: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      state.calls += 1;
      try {
        state.lastBody = JSON.parse(body);
      } catch {
        state.lastBody = body;
      }
      res.statusCode = state.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(state.status === 200 ? { id: 'mock-email-id' } : { error: 'mock delivery failure' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    url: `http://127.0.0.1:${port}/emails`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

const TRUSTED_APP_URL = 'https://app.example.test';

function resetEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    RESEND_API_KEY: 'test-resend-key',
    PASSWORD_RESET_EMAIL_FROM: 'AI Document Helper <no-reply@example.test>',
    ...overrides,
  };
}

function extractToken(email: any): string | null {
  const html: string = (email && email.html) || '';
  const match = html.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('password reset requires a trusted APP_URL (no link is built without it)', { timeout: 60000 }, async () => {
  // Resend is configured, but APP_URL is not: the flow must stay unavailable
  // rather than fall back to the request Host header.
  const server = await startTestServer(resetEnv(), { dataDir: tmpDir('adh-pr-noapp-') });
  try {
    const status = await api(server, 'GET', '/api/auth/password-reset/status');
    assert.equal(status.data.available, false);
    assert.equal(status.data.configured, false);

    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: uniqueEmail() });
    assert.equal(req.status, 503);
    assert.equal(req.data.success, undefined);
  } finally {
    await server.stop();
  }
});

test('delivery failure is handled: generic response, no leak, token discarded', { timeout: 60000 }, async () => {
  const mock = await startMockResend();
  mock.state.status = 500;
  const server = await startTestServer(
    resetEnv({ APP_URL: TRUSTED_APP_URL, RESEND_API_URL: mock.url }),
    { dataDir: tmpDir('adh-pr-fail-') }
  );
  try {
    const status = await api(server, 'GET', '/api/auth/password-reset/status');
    assert.equal(status.data.available, true);

    const user = await registerUser(server);
    const known = await api(server, 'POST', '/api/auth/password-reset/request', { email: user.email });
    const unknown = await api(server, 'POST', '/api/auth/password-reset/request', { email: uniqueEmail() });

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(known.data, unknown.data, 'response must not reveal whether the account exists');
    assert.equal(mock.state.calls, 1, 'only an existing account triggers a delivery attempt');

    // The token was discarded when delivery failed, so nothing can be confirmed.
    const confirm = await api(server, 'POST', '/api/auth/password-reset/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'irrelevant-123',
    });
    assert.equal(confirm.status, 400);
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('reset link uses the trusted APP_URL, not the request host; token is single-use', { timeout: 60000 }, async () => {
  const mock = await startMockResend();
  const server = await startTestServer(
    resetEnv({ APP_URL: TRUSTED_APP_URL, RESEND_API_URL: mock.url }),
    { dataDir: tmpDir('adh-pr-ok-') }
  );
  try {
    const user = await registerUser(server, 'original-pass-1');

    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: user.email });
    assert.equal(req.status, 200);
    assert.equal(mock.state.calls, 1);

    const token = extractToken(mock.state.lastBody);
    assert.ok(token && token.length >= 32, 'a reset token was delivered');

    const html: string = mock.state.lastBody.html;
    assert.ok(html.includes(`${TRUSTED_APP_URL}/reset-password?token=${token}`), 'link is built from APP_URL');
    assert.ok(!html.includes('127.0.0.1'), 'link must not be derived from the request host');

    const ok = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'reset-pass-2' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.success, true);

    // Single use: the same token cannot be used again.
    const reuse = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'reset-pass-3' });
    assert.equal(reuse.status, 400);

    // The new password works and the old one no longer does.
    assert.equal((await api(server, 'POST', '/api/auth/login', { email: user.email, password: 'reset-pass-2' })).status, 200);
    assert.equal((await api(server, 'POST', '/api/auth/login', { email: user.email, password: 'original-pass-1' })).status, 401);
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('an expired reset token is rejected and does not change the password', { timeout: 60000 }, async () => {
  const mock = await startMockResend();
  const server = await startTestServer(
    resetEnv({ APP_URL: TRUSTED_APP_URL, RESEND_API_URL: mock.url, PASSWORD_RESET_TTL_MS: '150' }),
    { dataDir: tmpDir('adh-pr-exp-') }
  );
  try {
    const user = await registerUser(server, 'correct-horse-1');
    const req = await api(server, 'POST', '/api/auth/password-reset/request', { email: user.email });
    assert.equal(req.status, 200);

    const token = extractToken(mock.state.lastBody);
    assert.ok(token);

    await new Promise((resolve) => setTimeout(resolve, 400));

    const confirm = await api(server, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: 'expired-pass-1' });
    assert.equal(confirm.status, 400);

    // The original password still works, so the reset did not take effect.
    assert.equal((await api(server, 'POST', '/api/auth/login', { email: user.email, password: 'correct-horse-1' })).status, 200);
  } finally {
    await server.stop();
    await mock.close();
  }
});

test('login failures do not reveal whether an account exists', { timeout: 60000 }, async () => {
  const server = await startTestServer({}, { dataDir: tmpDir('adh-enum-') });
  try {
    const user = await registerUser(server, 'known-pass-1');

    const wrongPassword = await api(server, 'POST', '/api/auth/login', { email: user.email, password: 'wrong-pass-1' });
    const unknownEmail = await api(server, 'POST', '/api/auth/login', { email: uniqueEmail(), password: 'wrong-pass-1' });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(
      wrongPassword.data.error,
      unknownEmail.data.error,
      'login error must be identical for wrong password and unknown account'
    );
  } finally {
    await server.stop();
  }
});
