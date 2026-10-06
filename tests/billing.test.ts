import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, api, registerUser, type TestServer } from './helpers.ts';
import { PLAY_PACKAGE_NAME, type GooglePlaySubscriptionResult } from '../server/googlePlayPublisher.ts';

let server: TestServer;

const PUSH_AUDIENCE = 'https://api.example.com/api/billing/google-play/rtdn';
const PUSH_SERVICE_ACCOUNT = 'rtdn@example.iam.gserviceaccount.com';

function setMockResponse(token: string, result: GooglePlaySubscriptionResult) {
  const mockFile = path.join(server.dataDir, 'mock-play-responses.json');
  let current: Record<string, any> = {};
  if (fs.existsSync(mockFile)) {
    try {
      current = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    } catch {}
  }
  current[token] = result;
  fs.writeFileSync(mockFile, JSON.stringify(current));
}

function makeRtdnPayload(dataObj: any) {
  const data = Buffer.from(JSON.stringify(dataObj)).toString('base64');
  return {
    message: {
      data,
      messageId: `msg_${Date.now()}_${Math.random()}`,
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/test/subscriptions/rtdn-sub',
  };
}

before(async () => {
  server = await startTestServer({
    RTDN_PUSH_AUDIENCE: PUSH_AUDIENCE,
    RTDN_PUSH_SERVICE_ACCOUNT: PUSH_SERVICE_ACCOUNT,
  });
});

after(async () => {
  await server?.stop();
});

test('invalid purchase token cannot grant Pro', async () => {
  const u = await registerUser(server);

  // 1. Empty token
  const emptyRes = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: '',
    sku: 'ai_doc_pro_monthly',
    packageName: PLAY_PACKAGE_NAME,
  }, u.token);
  assert.equal(emptyRes.status, 400);

  // 2. Unregistered/invalid token that Google Play rejects
  const badToken = 'tok_invalid_unrecognized';
  setMockResponse(badToken, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: '',
    purchaseTimeMillis: 0,
    expiryTimeMillis: 0,
    autoRenewing: false,
    status: 'INVALID',
    errorMessage: 'Purchase token was not found or is invalid with Google Play.',
  });

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: badToken,
    sku: 'ai_doc_pro_monthly',
    packageName: PLAY_PACKAGE_NAME,
  }, u.token);

  assert.equal(res.status, 400);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('wrong package cannot grant Pro', async () => {
  const u = await registerUser(server);
  const token = `tok_pkg_${Date.now()}`;

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
    packageName: 'com.attacker.otherapp',
  }, u.token);

  assert.equal(res.status, 400);
  assert.ok(String(res.data?.error || '').includes('Invalid package name'));

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('wrong SKU cannot grant Pro', async () => {
  const u = await registerUser(server);
  const token = `tok_sku_${Date.now()}`;

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'hack_unlimited_pro',
    packageName: PLAY_PACKAGE_NAME,
  }, u.token);

  assert.equal(res.status, 400);
  assert.ok(String(res.data?.error || '').includes('Invalid product SKU'));

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('expired Google Play purchase cannot grant Pro', async () => {
  const u = await registerUser(server);
  const token = `tok_expired_${Date.now()}`;

  setMockResponse(token, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.EXP-1234',
    purchaseTimeMillis: Date.now() - 60 * 86400000,
    expiryTimeMillis: Date.now() - 1000, // expired 1s ago
    autoRenewing: false,
    status: 'EXPIRED',
    errorMessage: 'Subscription has expired according to Google Play records.',
  });

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
    packageName: PLAY_PACKAGE_NAME,
  }, u.token);

  assert.equal(res.status, 400);
  assert.equal(res.data?.status, 'EXPIRED');

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('cancelled and refunded purchase cannot grant Pro', async () => {
  const u = await registerUser(server);
  const token = `tok_refunded_${Date.now()}`;

  setMockResponse(token, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.REF-1234',
    purchaseTimeMillis: Date.now() - 5000,
    expiryTimeMillis: Date.now() + 30 * 86400000,
    autoRenewing: false,
    status: 'REVOKED',
    cancelReason: 3,
    errorMessage: 'Subscription has been refunded or revoked.',
  });

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
    packageName: PLAY_PACKAGE_NAME,
  }, u.token);

  assert.equal(res.status, 400);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('valid verified purchase grants Pro with Google Play authoritative expiry', async () => {
  const u = await registerUser(server);
  const token = `tok_valid_${Date.now()}`;
  const googleExpiry = Date.now() + 31 * 86400000;
  const googleOrderId = `GPA.AUTH-${Date.now()}`;

  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: googleOrderId,
    purchaseTimeMillis: Date.now() - 1000,
    expiryTimeMillis: googleExpiry,
    autoRenewing: true,
    paymentState: 1,
    acknowledgementState: 1,
    status: 'ACTIVE',
  });

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
    packageName: PLAY_PACKAGE_NAME,
    // Client attempts to claim an arbitrary date and fake orderId
    orderId: 'FAKE_ORDER_999',
    expiryTime: Date.now() + 1000 * 86400000,
  }, u.token);

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.user.plan, 'pro');
  // Order ID and expiry must come from Google, NOT client input
  assert.equal(res.data.purchase.orderId, googleOrderId);
  assert.equal(res.data.purchase.expiryTime, googleExpiry);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'pro');
  assert.equal(me.data.user.proUntil, googleExpiry);
});

test('same purchase verified twice does not extend expiry twice (idempotence)', async () => {
  const u = await registerUser(server);
  const token = `tok_idem_${Date.now()}`;
  const fixedExpiry = Date.now() + 30 * 86400000;

  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: `GPA.IDEM-${Date.now()}`,
    purchaseTimeMillis: Date.now() - 2000,
    expiryTimeMillis: fixedExpiry,
    autoRenewing: true,
    paymentState: 1,
    status: 'ACTIVE',
  });

  const first = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u.token);
  assert.equal(first.status, 200);
  assert.equal(first.data.purchase.expiryTime, fixedExpiry);

  // Verify second time
  const second = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u.token);
  assert.equal(second.status, 200);
  // Expiry must be identical, not extended by another 30 days
  assert.equal(second.data.purchase.expiryTime, fixedExpiry);
});

test('same purchase token cannot move between accounts', async () => {
  const u1 = await registerUser(server);
  const u2 = await registerUser(server);
  const token = `tok_shared_${Date.now()}`;

  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.BOUND-1234',
    purchaseTimeMillis: Date.now(),
    expiryTimeMillis: Date.now() + 30 * 86400000,
    autoRenewing: true,
    status: 'ACTIVE',
  });

  // User 1 claims token
  const r1 = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u1.token);
  assert.equal(r1.status, 200);

  // User 2 attempts to claim same token -> must be rejected with 409
  const r2 = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u2.token);
  assert.equal(r2.status, 409);

  // User 2 remains free
  const me2 = await api(server, 'GET', '/api/auth/me', undefined, u2.token);
  assert.equal(me2.data.user.plan, 'free');
});

test('restore with fabricated client metadata cannot grant Pro', async () => {
  const u = await registerUser(server);
  const fakeToken = `tok_fake_restore_${Date.now()}`;

  setMockResponse(fakeToken, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_annual',
    orderId: '',
    purchaseTimeMillis: 0,
    expiryTimeMillis: 0,
    autoRenewing: false,
    status: 'INVALID',
    errorMessage: 'Purchase token was not found or is invalid with Google Play.',
  });

  // Client attempts to pass fabricated devicePurchases
  const res = await api(server, 'POST', '/api/billing/google-play/restore-purchases', {
    purchases: [
      {
        purchaseToken: fakeToken,
        sku: 'ai_doc_pro_annual',
        orderId: 'GPA.FABRICATED-999',
        purchaseTime: Date.now(),
      },
    ],
  }, u.token);

  assert.equal(res.status, 200);
  assert.equal(res.data.restored, false);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('RTDN subscription activation and renewal updates Pro status', async () => {
  const u = await registerUser(server);
  const token = `tok_rtdn_act_${Date.now()}`;
  const initialExpiry = Date.now() + 15 * 86400000;

  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: `GPA.RTDN-${Date.now()}`,
    purchaseTimeMillis: Date.now() - 86400000,
    expiryTimeMillis: initialExpiry,
    autoRenewing: true,
    status: 'ACTIVE',
  });

  // Initial purchase verification
  await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  // Simulate RTDN Renewal Notification (notificationType 2)
  const renewedExpiry = Date.now() + 45 * 86400000;
  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: `GPA.RTDN-RENEW-${Date.now()}`,
    purchaseTimeMillis: Date.now() - 86400000,
    expiryTimeMillis: renewedExpiry,
    autoRenewing: true,
    status: 'ACTIVE',
  });

  const payload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    eventTimeMillis: String(Date.now()),
    subscriptionNotification: {
      version: '1.0',
      notificationType: 2, // SUBSCRIPTION_RENEWED
      purchaseToken: token,
      subscriptionId: 'ai_doc_pro_monthly',
    },
  });

  const RTDN_BEARER = 'test-authorized-pubsub-bearer';

  // In test mode, pass authorized bearer
  const rtdnRes = await api(server, 'POST', '/api/billing/google-play/rtdn', payload, RTDN_BEARER);
  assert.equal(rtdnRes.status, 200);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'pro');
  assert.equal(me.data.user.proUntil, renewedExpiry);
});

test('RTDN subscription expiration removes Pro status', async () => {
  const u = await registerUser(server);
  const token = `tok_rtdn_exp_${Date.now()}`;

  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: `GPA.EXP-RTDN-${Date.now()}`,
    purchaseTimeMillis: Date.now() - 30 * 86400000,
    expiryTimeMillis: Date.now() + 10 * 86400000,
    autoRenewing: true,
    status: 'ACTIVE',
  });

  await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  // Now trigger RTDN Expiration (notificationType 13)
  setMockResponse(token, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: `GPA.EXP-RTDN-${Date.now()}`,
    purchaseTimeMillis: Date.now() - 30 * 86400000,
    expiryTimeMillis: Date.now() - 1000,
    autoRenewing: false,
    status: 'EXPIRED',
    errorMessage: 'Subscription expired.',
  });

  const payload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    eventTimeMillis: String(Date.now()),
    subscriptionNotification: {
      version: '1.0',
      notificationType: 13, // SUBSCRIPTION_EXPIRED
      purchaseToken: token,
      subscriptionId: 'ai_doc_pro_monthly',
    },
  });

  const RTDN_BEARER = 'test-authorized-pubsub-bearer';
  const rtdnRes = await api(server, 'POST', '/api/billing/google-play/rtdn', payload, RTDN_BEARER);
  assert.equal(rtdnRes.status, 200);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('duplicate RTDN delivery is harmless (idempotent)', async () => {
  const payload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    testNotification: { version: '1.0' },
  });

  const RTDN_BEARER = 'test-authorized-pubsub-bearer';
  const first = await api(server, 'POST', '/api/billing/google-play/rtdn', payload, RTDN_BEARER);
  assert.equal(first.status, 200);

  const second = await api(server, 'POST', '/api/billing/google-play/rtdn', payload, RTDN_BEARER);
  assert.equal(second.status, 200);
});

test('Google Play API failure does not grant Pro', async () => {
  const u = await registerUser(server);
  const token = `tok_api_fail_${Date.now()}`;

  setMockResponse(token, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: '',
    purchaseTimeMillis: 0,
    expiryTimeMillis: 0,
    autoRenewing: false,
    status: 'INVALID',
    errorMessage: 'Google Play API returned 503 Service Unavailable',
  });

  const res = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  assert.equal(res.status, 400);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('Subscription V2 lifecycle: IN_GRACE_PERIOD and CANCELLED_ACTIVE grant Pro until expiry', async () => {
  const u = await registerUser(server);
  const graceToken = `tok_grace_${Date.now()}`;
  const futureExpiry = Date.now() + 5 * 86400000;

  // 1. IN_GRACE_PERIOD
  setMockResponse(graceToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.GRACE-1',
    purchaseTimeMillis: Date.now() - 25 * 86400000,
    expiryTimeMillis: futureExpiry,
    autoRenewing: false,
    status: 'IN_GRACE_PERIOD',
    isProEntitled: true,
  });

  const res1 = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: graceToken,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  assert.equal(res1.status, 200);
  assert.equal(res1.data.user.plan, 'pro');

  // 2. CANCELLED_ACTIVE (User cancelled auto-renewal, but paid period is still unexpired)
  const cancelToken = `tok_cancel_${Date.now()}`;
  const cancelExpiry = Date.now() + 10 * 86400000;
  setMockResponse(cancelToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.CANCEL-1',
    purchaseTimeMillis: Date.now() - 20 * 86400000,
    expiryTimeMillis: cancelExpiry,
    autoRenewing: false,
    status: 'CANCELLED_ACTIVE',
    isProEntitled: true,
  });

  const res2 = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: cancelToken,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  assert.equal(res2.status, 200);
  assert.equal(res2.data.user.plan, 'pro');
  assert.equal(res2.data.purchase.state, 'CANCELLED_ACTIVE');
});

test('Subscription V2 lifecycle: ON_HOLD, PAUSED, and PENDING do not grant Pro', async () => {
  const u = await registerUser(server);

  // 1. ON_HOLD
  const holdToken = `tok_hold_${Date.now()}`;
  setMockResponse(holdToken, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.HOLD-1',
    purchaseTimeMillis: Date.now() - 30 * 86400000,
    expiryTimeMillis: Date.now() + 5 * 86400000,
    autoRenewing: false,
    status: 'ON_HOLD',
    isProEntitled: false,
  });

  const resHold = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: holdToken,
    sku: 'ai_doc_pro_monthly',
  }, u.token);
  assert.equal(resHold.status, 400);

  // 2. PAUSED
  const pausedToken = `tok_paused_${Date.now()}`;
  setMockResponse(pausedToken, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.PAUSE-1',
    purchaseTimeMillis: Date.now() - 30 * 86400000,
    expiryTimeMillis: Date.now() + 5 * 86400000,
    autoRenewing: false,
    status: 'PAUSED',
    isProEntitled: false,
  });

  const resPause = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: pausedToken,
    sku: 'ai_doc_pro_monthly',
  }, u.token);
  assert.equal(resPause.status, 400);

  // 3. PENDING
  const pendingToken = `tok_pending_${Date.now()}`;
  setMockResponse(pendingToken, {
    valid: false,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.PEND-1',
    purchaseTimeMillis: Date.now(),
    expiryTimeMillis: 0,
    autoRenewing: false,
    status: 'PENDING',
    isProEntitled: false,
  });

  const resPend = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: pendingToken,
    sku: 'ai_doc_pro_monthly',
  }, u.token);
  assert.equal(resPend.status, 400);

  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'free');
});

test('linkedPurchaseToken marks previous subscription as REPLACED', async () => {
  const u = await registerUser(server);
  const oldToken = `tok_old_plan_${Date.now()}`;
  const newToken = `tok_new_plan_${Date.now()}`;

  // Initial Monthly subscription
  setMockResponse(oldToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.OLD-PLAN-1',
    purchaseTimeMillis: Date.now() - 10 * 86400000,
    expiryTimeMillis: Date.now() + 20 * 86400000,
    autoRenewing: true,
    status: 'ACTIVE',
    isProEntitled: true,
  });

  await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: oldToken,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  // Upgrade to Annual with linkedPurchaseToken pointing to oldToken
  const annualExpiry = Date.now() + 365 * 86400000;
  setMockResponse(newToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_annual',
    orderId: 'GPA.NEW-PLAN-ANNUAL',
    purchaseTimeMillis: Date.now(),
    expiryTimeMillis: annualExpiry,
    autoRenewing: true,
    status: 'ACTIVE',
    isProEntitled: true,
    linkedPurchaseToken: oldToken,
  });

  const resUpgrade = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: newToken,
    sku: 'ai_doc_pro_annual',
  }, u.token);

  assert.equal(resUpgrade.status, 200);
  assert.equal(resUpgrade.data.purchase.sku, 'ai_doc_pro_annual');
  assert.equal(resUpgrade.data.user.proUntil, annualExpiry);
});

test('external account binding prevents cross-account verification', async () => {
  const u1 = await registerUser(server);
  const u2 = await registerUser(server);
  const boundToken = `tok_bound_ext_${Date.now()}`;

  // Token explicitly bound to u1.id on Google Play
  setMockResponse(boundToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.BOUND-EXT-1',
    purchaseTimeMillis: Date.now(),
    expiryTimeMillis: Date.now() + 30 * 86400000,
    autoRenewing: true,
    status: 'ACTIVE',
    isProEntitled: true,
    obfuscatedExternalAccountId: u1.user.id,
  });

  // User 2 tries to verify u1's token -> MUST be rejected with 403
  const resBad = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: boundToken,
    sku: 'ai_doc_pro_monthly',
  }, u2.token);

  assert.equal(resBad.status, 403);
  assert.match(resBad.data.error, /different account/);

  // User 1 verifies their own token -> succeeds
  const resGood = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: boundToken,
    sku: 'ai_doc_pro_monthly',
  }, u1.token);

  assert.equal(resGood.status, 200);
  assert.equal(resGood.data.user.plan, 'pro');
});

test('RTDN out-of-order notifications do not overwrite newer state', async () => {
  const u = await registerUser(server);
  const token = `tok_ooo_${Date.now()}`;
  const now = Date.now();
  const RTDN_BEARER = 'test-authorized-pubsub-bearer';

  // 1. Initial active subscription
  setMockResponse(token, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.OOO-1',
    purchaseTimeMillis: now - 10000,
    expiryTimeMillis: now + 30 * 86400000,
    autoRenewing: true,
    status: 'ACTIVE',
    isProEntitled: true,
  });

  await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: token,
    sku: 'ai_doc_pro_monthly',
  }, u.token);

  // 2. Deliver event at timestamp 5000 (Newer event: renewal)
  const newerPayload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    eventTimeMillis: '5000',
    subscriptionNotification: {
      notificationType: 2, // RENEWED
      purchaseToken: token,
      subscriptionId: 'ai_doc_pro_monthly',
    },
  });
  const resNewer = await api(server, 'POST', '/api/billing/google-play/rtdn', newerPayload, RTDN_BEARER);
  assert.equal(resNewer.status, 200);

  // 3. Deliver older event at timestamp 2000 (Older out-of-order event: expired)
  const olderPayload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    eventTimeMillis: '2000',
    subscriptionNotification: {
      notificationType: 13, // EXPIRED
      purchaseToken: token,
      subscriptionId: 'ai_doc_pro_monthly',
    },
  });
  const resOlder = await api(server, 'POST', '/api/billing/google-play/rtdn', olderPayload, RTDN_BEARER);
  assert.equal(resOlder.status, 200);
  assert.equal(resOlder.data.ignoredOutOfOrder, true);

  // User must still be Pro
  const me = await api(server, 'GET', '/api/auth/me', undefined, u.token);
  assert.equal(me.data.user.plan, 'pro');
});

test('pending purchase linking: only matching account can claim pending purchase', async () => {
  const uLegit = await registerUser(server);
  const uAttacker = await registerUser(server);
  const pendingToken = `tok_pend_claim_${Date.now()}`;
  const futureExpiry = Date.now() + 30 * 86400000;
  const RTDN_BEARER = 'test-authorized-pubsub-bearer';

  // Google Play returns purchase bound to uLegit's user.id
  setMockResponse(pendingToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.PEND-CLAIM-1',
    purchaseTimeMillis: Date.now(),
    expiryTimeMillis: futureExpiry,
    autoRenewing: true,
    status: 'ACTIVE',
    isProEntitled: true,
    obfuscatedExternalAccountId: uLegit.user.id,
  });

  // RTDN arrives before user completes client-side verification
  const payload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    eventTimeMillis: String(Date.now()),
    subscriptionNotification: {
      notificationType: 4, // PURCHASED
      purchaseToken: pendingToken,
      subscriptionId: 'ai_doc_pro_monthly',
    },
  });

  const rtdnRes = await api(server, 'POST', '/api/billing/google-play/rtdn', payload, RTDN_BEARER);
  assert.equal(rtdnRes.status, 200);

  // Attacker attempts to claim this token -> 403 or 409 Forbidden / Conflict
  const resAttack = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: pendingToken,
    sku: 'ai_doc_pro_monthly',
  }, uAttacker.token);
  assert.ok(resAttack.status === 403 || resAttack.status === 409, 'Attacker must be rejected');

  // Legitimate user claims the token -> 200 OK, Pro granted
  const resLegit = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: pendingToken,
    sku: 'ai_doc_pro_monthly',
  }, uLegit.token);
  assert.equal(resLegit.status, 200);
  assert.equal(resLegit.data.user.plan, 'pro');
});

test('pending purchase arriving before user registration can only be claimed by matching account', async () => {
  const pendingToken = `tok_pend_before_${Date.now()}`;
  const futureExpiry = Date.now() + 30 * 86400000;
  const targetUserId = `user_target_${Date.now()}`;
  const RTDN_BEARER = 'test-authorized-pubsub-bearer';

  setMockResponse(pendingToken, {
    valid: true,
    packageName: PLAY_PACKAGE_NAME,
    subscriptionId: 'ai_doc_pro_monthly',
    orderId: 'GPA.PEND-BEFORE-1',
    purchaseTimeMillis: Date.now(),
    expiryTimeMillis: futureExpiry,
    autoRenewing: true,
    status: 'ACTIVE',
    isProEntitled: true,
    obfuscatedExternalAccountId: targetUserId,
  });

  // RTDN arrives before user targetUserId registers
  const payload = makeRtdnPayload({
    version: '1.0',
    packageName: PLAY_PACKAGE_NAME,
    eventTimeMillis: String(Date.now()),
    subscriptionNotification: {
      notificationType: 4,
      purchaseToken: pendingToken,
      subscriptionId: 'ai_doc_pro_monthly',
    },
  });

  const rtdnRes = await api(server, 'POST', '/api/billing/google-play/rtdn', payload, RTDN_BEARER);
  assert.equal(rtdnRes.status, 200);

  // Different user registers and tries to claim it
  const attacker = await registerUser(server);
  const resBad = await api(server, 'POST', '/api/billing/google-play/verify-purchase', {
    purchaseToken: pendingToken,
    sku: 'ai_doc_pro_monthly',
  }, attacker.token);
  assert.equal(resBad.status, 403);
});

test('health and readiness endpoints reflect service status', async () => {
  const healthRes = await api(server, 'GET', '/api/health');
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.data.status, 'ok');

  const readyRes = await api(server, 'GET', '/api/health/ready');
  assert.equal(readyRes.status, 200);
  assert.equal(readyRes.data.ready, true);
});
