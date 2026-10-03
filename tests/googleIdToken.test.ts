import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  issueGoogleSignInNonce,
  verifyGoogleIdTokenForSignIn,
  verifyPubSubPushToken,
} from '../server/googleIdToken.ts';

const AUD = 'web-client.apps.googleusercontent.com';
const nowSec = () => Math.floor(Date.now() / 1000);

let counter = 0;
function token(): string {
  counter += 1;
  return `test-id-token-${counter}-${Math.random()}`;
}

function payload(extra: Record<string, any> = {}) {
  return {
    aud: AUD,
    iss: 'https://accounts.google.com',
    exp: nowSec() + 600,
    iat: nowSec(),
    sub: '1234567890',
    email: 'user@example.com',
    email_verified: true,
    ...extra,
  };
}

const verifyWith = (p: any) => ({ verify: async () => p });

test('accepts a token with a server-issued nonce exactly once', async () => {
  const nonce = issueGoogleSignInNonce();
  const idToken = token();

  const first = await verifyGoogleIdTokenForSignIn(idToken, [AUD], verifyWith(payload({ nonce })));
  assert.equal(first.ok, true);

  // Same token again -> replay rejected.
  const replay = await verifyGoogleIdTokenForSignIn(idToken, [AUD], verifyWith(payload({ nonce })));
  assert.equal(replay.ok, false);

  // Different token carrying the already-used nonce -> rejected.
  const reusedNonce = await verifyGoogleIdTokenForSignIn(token(), [AUD], verifyWith(payload({ nonce })));
  assert.equal(reusedNonce.ok, false);
});

test('rejects a nonce that the server never issued', async () => {
  const res = await verifyGoogleIdTokenForSignIn(token(), [AUD], verifyWith(payload({ nonce: 'attacker-chosen-nonce-value-1234567890' })));
  assert.equal(res.ok, false);
});

test('rejects wrong audience, issuer, expiry and unverified email', async () => {
  const cases = [
    payload({ aud: 'other-client' }),
    payload({ iss: 'https://evil.example.com' }),
    payload({ exp: nowSec() - 10 }),
    payload({ email_verified: false }),
  ];

  for (const p of cases) {
    const res = await verifyGoogleIdTokenForSignIn(token(), [AUD], verifyWith({ ...p, nonce: issueGoogleSignInNonce() }));
    assert.equal(res.ok, false, JSON.stringify(p));
  }
});

test('rejects tokens whose signature verification fails', async () => {
  const res = await verifyGoogleIdTokenForSignIn(token(), [AUD], {
    verify: async () => {
      throw new Error('Invalid token signature');
    },
  });
  assert.equal(res.ok, false);
  assert.equal((res as any).status, 401);
});

test('nonce-less tokens (legacy fallback) must be fresh', async () => {
  const fresh = await verifyGoogleIdTokenForSignIn(token(), [AUD], verifyWith(payload()));
  assert.equal(fresh.ok, true);

  const stale = await verifyGoogleIdTokenForSignIn(token(), [AUD], verifyWith(payload({ iat: nowSec() - 3600 })));
  assert.equal(stale.ok, false);
});

test('reports a configuration error when no audience is configured', async () => {
  const res = await verifyGoogleIdTokenForSignIn(token(), ['', undefined], verifyWith(payload()));
  assert.equal(res.ok, false);
  assert.equal((res as any).status, 503);
});

test('real verifier rejects a forged (unsigned) token', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload({ nonce: issueGoogleSignInNonce() }))).toString('base64url');
  const res = await verifyGoogleIdTokenForSignIn(`${header}.${body}.`, [AUD]);
  assert.equal(res.ok, false);
});

test('Pub/Sub push token must match audience and service account', async () => {
  const config = { audience: 'https://api.example.com/api/billing/google-play/rtdn', serviceAccountEmail: 'rtdn@proj.iam.gserviceaccount.com' };
  const good = { aud: config.audience, iss: 'https://accounts.google.com', exp: nowSec() + 60, email: config.serviceAccountEmail, email_verified: true };

  assert.equal(await verifyPubSubPushToken('Bearer x', config, verifyWith(good)), true);
  assert.equal(await verifyPubSubPushToken(undefined, config, verifyWith(good)), false);
  assert.equal(await verifyPubSubPushToken('Bearer x', config, verifyWith({ ...good, email: 'other@x.com' })), false);
  assert.equal(await verifyPubSubPushToken('Bearer x', config, verifyWith({ ...good, aud: 'other' })), false);
  assert.equal(await verifyPubSubPushToken('Bearer x', config, verifyWith({ ...good, email_verified: false })), false);
  assert.equal(await verifyPubSubPushToken('Bearer forged', config), false);
});
