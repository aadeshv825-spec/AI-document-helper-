import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adh-store-'));
delete process.env.DATABASE_URL;
delete process.env.REQUIRE_DATABASE;

let store: typeof import('../server/store.ts');

before(async () => {
  store = await import('../server/store.ts');
  await store.initStore();
});

test('free daily limit cannot be exceeded by concurrent reservations', async () => {
  const id = `user:concurrency-${Date.now()}`;
  const attempts = await Promise.all(
    Array.from({ length: 25 }, async () => store.reserveDailyUsage(id, false))
  );
  assert.equal(attempts.filter((a) => a.allowed).length, store.FREE_DAILY_LIMIT);
  assert.equal(store.getDailyUsage(id, false).dailyUsed, store.FREE_DAILY_LIMIT);
});

test('released reservations give the action back; never below zero', () => {
  const id = `user:release-${Date.now()}`;
  const r = store.reserveDailyUsage(id, false);
  assert.equal(store.getDailyUsage(id, false).dailyUsed, 1);
  store.releaseDailyUsage(r.key);
  assert.equal(store.getDailyUsage(id, false).dailyUsed, 0);
  store.releaseDailyUsage(r.key);
  assert.equal(store.getDailyUsage(id, false).dailyUsed, 0);
});

test('Pro is unlimited', () => {
  const id = `user:pro-${Date.now()}`;
  for (let i = 0; i < 20; i += 1) {
    assert.equal(store.reserveDailyUsage(id, true).allowed, true);
  }
});

test('setUserPassword revokes every session and rejects weak passwords', () => {
  const email = `pw${Date.now()}@example.com`;
  const { user, token } = store.registerUser('PW User', email, 'initial-pass-1') as any;
  assert.ok(store.getUserByToken(token));
  assert.throws(() => store.setUserPassword(user.id, '12'));
  store.setUserPassword(user.id, 'second-pass-2');
  assert.equal(store.getUserByToken(token), null);
  assert.equal(store.verifyUserPassword(user.id, 'second-pass-2'), true);
  assert.equal(store.verifyUserPassword(user.id, 'initial-pass-1'), false);
});

test('a Google Play purchase token can never move to another account', () => {
  const a = store.registerUser('A', `a${Date.now()}@example.com`, 'pass-aaaa-1') as any;
  const b = store.registerUser('B', `b${Date.now()}@example.com`, 'pass-bbbb-1') as any;
  const base = {
    id: `gp_${Date.now()}`,
    purchaseToken: `tok-${Date.now()}`,
    sku: 'ai_doc_pro_monthly',
    purchaseTime: Date.now(),
    expiryTime: Date.now() + 86400000,
    state: 'VERIFIED' as const,
    verifiedAt: Date.now(),
  };
  store.recordGooglePlayPurchase({ ...base, userId: a.user.id });
  assert.throws(() => store.recordGooglePlayPurchase({ ...base, userId: b.user.id }));
});

test('write confirmation reports JSON storage success', async () => {
  const mark = store.getWriteMark();
  store.registerUser('C', `c${Date.now()}@example.com`, 'pass-cccc-1');
  assert.equal(await store.confirmPersisted(mark), true);
});
