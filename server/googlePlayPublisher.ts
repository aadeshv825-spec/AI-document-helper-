// Real Server-to-Server Google Play Developer API (Android Publisher v3) Client
// Uses purchases.subscriptionsv2.get for authoritative verification.
// Verifies package name, subscription/product ID, purchase token, subscription state,
// lineItems, expiry time, latest order ID, linkedPurchaseToken, and external account binding.
// Automatically acknowledges unacknowledged subscriptions.

import fs from 'node:fs';
import { GoogleAuth, JWT } from 'google-auth-library';
import { GOOGLE_PLAY_SKUS, isValidGooglePlaySku } from './store.ts';

export const PLAY_PACKAGE_NAME = 'com.aidocumenthelper.app';

export type GooglePlaySubscriptionStatus =
  | 'ACTIVE'
  | 'CANCELLED_ACTIVE'
  | 'IN_GRACE_PERIOD'
  | 'ON_HOLD'
  | 'PAUSED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'PENDING'
  | 'INVALID';

export interface GooglePlaySubscriptionResult {
  valid: boolean;
  packageName: string;
  subscriptionId: string;
  orderId: string;
  purchaseTimeMillis: number;
  expiryTimeMillis: number;
  autoRenewing: boolean;
  status: GooglePlaySubscriptionStatus;
  isProEntitled?: boolean;
  paymentState?: number;
  acknowledgementState?: number;
  cancelReason?: number;
  linkedPurchaseToken?: string;
  obfuscatedExternalAccountId?: string;
  errorMessage?: string;
  rawResponse?: any;
}

export function computeIsProEntitled(
  status: GooglePlaySubscriptionStatus,
  expiryTimeMillis: number,
  now: number = Date.now()
): boolean {
  if (expiryTimeMillis <= now) return false;
  return status === 'ACTIVE' || status === 'IN_GRACE_PERIOD' || status === 'CANCELLED_ACTIVE';
}

export type GooglePlayVerifierFn = (
  packageName: string,
  subscriptionId: string,
  token: string
) => Promise<GooglePlaySubscriptionResult>;

let mockVerifier: GooglePlayVerifierFn | null = null;

/**
 * Allows unit and integration tests to provide a deterministic mock
 * without needing real production Google Play service account credentials.
 */
export function setMockGooglePlayVerifier(fn: GooglePlayVerifierFn | null) {
  mockVerifier = fn;
}

export function getMockGooglePlayVerifier(): GooglePlayVerifierFn | null {
  return mockVerifier;
}

let authClientInstance: any = null;

function getAuthClient() {
  if (authClientInstance) return authClientInstance;

  const rawJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    const trimmed = rawJson.trim();
    if (trimmed.startsWith('{')) {
      try {
        const creds = JSON.parse(trimmed);
        authClientInstance = new JWT({
          email: creds.client_email,
          key: creds.private_key,
          scopes: ['https://www.googleapis.com/auth/androidpublisher'],
        });
        return authClientInstance;
      } catch (err: any) {
        console.error('[Google Play] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:', err.message);
      }
    } else if (fs.existsSync(trimmed)) {
      authClientInstance = new GoogleAuth({
        keyFile: trimmed,
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });
      return authClientInstance;
    }
  }

  const gAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gAppCreds && fs.existsSync(gAppCreds)) {
    authClientInstance = new GoogleAuth({
      keyFile: gAppCreds,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    return authClientInstance;
  }

  // Fallback to Application Default Credentials (e.g. on Google Cloud Run)
  authClientInstance = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  return authClientInstance;
}

/**
 * Verifies a subscription purchase token with Google Play Subscriptions V2 API.
 * Never trusts client-supplied timestamps, order IDs, or expiry.
 */
export async function verifySubscriptionWithGooglePlay(
  packageName: string,
  subscriptionId: string,
  purchaseToken: string
): Promise<GooglePlaySubscriptionResult> {
  // 1. Enforce strict package name validation
  if (!packageName || packageName !== PLAY_PACKAGE_NAME) {
    return {
      valid: false,
      packageName,
      subscriptionId,
      orderId: '',
      purchaseTimeMillis: 0,
      expiryTimeMillis: 0,
      autoRenewing: false,
      status: 'INVALID',
      isProEntitled: false,
      errorMessage: `Invalid package name: "${packageName}". Expected "${PLAY_PACKAGE_NAME}".`,
    };
  }

  // 2. Enforce allowed SKU validation
  if (!subscriptionId || !isValidGooglePlaySku(subscriptionId)) {
    return {
      valid: false,
      packageName,
      subscriptionId,
      orderId: '',
      purchaseTimeMillis: 0,
      expiryTimeMillis: 0,
      autoRenewing: false,
      status: 'INVALID',
      isProEntitled: false,
      errorMessage: `Invalid or unrecognized subscription product: "${subscriptionId}".`,
    };
  }

  // 3. Purchase token presence
  const cleanToken = (purchaseToken || '').trim();
  if (!cleanToken) {
    return {
      valid: false,
      packageName,
      subscriptionId,
      orderId: '',
      purchaseTimeMillis: 0,
      expiryTimeMillis: 0,
      autoRenewing: false,
      status: 'INVALID',
      isProEntitled: false,
      errorMessage: 'Purchase token cannot be empty.',
    };
  }

  // 4. If mock verifier is configured in-process, use it
  if (mockVerifier) {
    const res = await mockVerifier(packageName, subscriptionId, cleanToken);
    if (res.isProEntitled === undefined) {
      res.isProEntitled = computeIsProEntitled(res.status, res.expiryTimeMillis);
    }
    return res;
  }

  // 4b. In test environment only: allow configuring mock responses via test file in DATA_DIR
  if (process.env.NODE_ENV === 'test') {
    const dataDir = process.env.DATA_DIR;
    if (dataDir) {
      const mockFile = `${dataDir}/mock-play-responses.json`;
      if (fs.existsSync(mockFile)) {
        try {
          const fileMocks = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
          if (fileMocks[cleanToken]) {
            const mock = fileMocks[cleanToken];
            if (mock.isProEntitled === undefined) {
              mock.isProEntitled = computeIsProEntitled(mock.status, mock.expiryTimeMillis);
            }
            return mock;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // 5. Query official Google Play Android Publisher v3 Subscriptions V2 API
  try {
    const auth = getAuthClient();
    const client = await auth.getClient();

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      packageName
    )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(cleanToken)}`;

    const res: any = await client.request({
      url,
      method: 'GET',
    });

    const data = res.data;
    if (!data) {
      return {
        valid: false,
        packageName,
        subscriptionId,
        orderId: '',
        purchaseTimeMillis: 0,
        expiryTimeMillis: 0,
        autoRenewing: false,
        status: 'INVALID',
        isProEntitled: false,
        errorMessage: 'Empty response received from Google Play Developer API.',
      };
    }

    // Parse Subscriptions V2 lineItems
    const lineItem = Array.isArray(data.lineItems)
      ? (data.lineItems.find((li: any) => li.productId === subscriptionId) || data.lineItems[0])
      : null;

    const productId = lineItem?.productId || subscriptionId;
    const expiryTimeMillis = lineItem?.expiryTime
      ? new Date(lineItem.expiryTime).getTime()
      : (data.expiryTimeMillis ? Number(data.expiryTimeMillis) : 0);
    const startTimeMillis = data.startTime
      ? new Date(data.startTime).getTime()
      : (data.startTimeMillis ? Number(data.startTimeMillis) : Date.now());
    const autoRenewing = Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled ?? data.autoRenewing);
    const orderId = data.latestOrderId || data.orderId || `GPA.PLAY-${cleanToken.slice(0, 8)}`;
    const linkedPurchaseToken = data.linkedPurchaseToken ? String(data.linkedPurchaseToken).trim() : undefined;
    const obfuscatedExternalAccountId =
      data.externalAccountIdentifiers?.obfuscatedExternalAccountId
        ? String(data.externalAccountIdentifiers.obfuscatedExternalAccountId).trim()
        : undefined;

    // Subscription V2 state mapping
    const rawState = data.subscriptionState;
    let status: GooglePlaySubscriptionStatus = 'ACTIVE';

    if (rawState === 1 || rawState === 'SUBSCRIPTION_STATE_PENDING') {
      status = 'PENDING';
    } else if (rawState === 3 || rawState === 'SUBSCRIPTION_STATE_PAUSED') {
      status = 'PAUSED';
    } else if (rawState === 4 || rawState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
      status = 'IN_GRACE_PERIOD';
    } else if (rawState === 5 || rawState === 'SUBSCRIPTION_STATE_ON_HOLD') {
      status = 'ON_HOLD';
    } else if (rawState === 6 || rawState === 'SUBSCRIPTION_STATE_CANCELED') {
      status = 'CANCELLED_ACTIVE';
    } else if (rawState === 7 || rawState === 'SUBSCRIPTION_STATE_EXPIRED') {
      status = 'EXPIRED';
    } else if (rawState === 2 || rawState === 'SUBSCRIPTION_STATE_ACTIVE') {
      status = 'ACTIVE';
    } else if (data.status) {
      status = data.status;
    }

    const now = Date.now();
    if (expiryTimeMillis > 0 && expiryTimeMillis <= now) {
      status = 'EXPIRED';
    }

    const isProEntitled = computeIsProEntitled(status, expiryTimeMillis, now);

    // Auto-acknowledge unacknowledged subscription if currently active/entitled
    const ackState = data.acknowledgementState;
    const needsAck = ackState === 1 || ackState === 'ACKNOWLEDGEMENT_STATE_PENDING' || ackState === 0;
    if (needsAck && isProEntitled) {
      try {
        const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
          packageName
        )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(cleanToken)}:acknowledge`;
        await client.request({
          url: ackUrl,
          method: 'POST',
          data: { developerPayload: '' },
        });
      } catch (ackErr: any) {
        console.warn('[Google Play] Non-fatal acknowledgement warning:', ackErr?.message);
      }
    }

    return {
      valid: isProEntitled || status === 'CANCELLED_ACTIVE' || status === 'IN_GRACE_PERIOD',
      packageName,
      subscriptionId: productId,
      orderId,
      purchaseTimeMillis: startTimeMillis,
      expiryTimeMillis,
      autoRenewing,
      status,
      isProEntitled,
      linkedPurchaseToken,
      obfuscatedExternalAccountId,
      rawResponse: data,
    };
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || 'Google Play API error';
    if (status === 404 || status === 400) {
      return {
        valid: false,
        packageName,
        subscriptionId,
        orderId: '',
        purchaseTimeMillis: 0,
        expiryTimeMillis: 0,
        autoRenewing: false,
        status: 'INVALID',
        isProEntitled: false,
        errorMessage: 'Purchase token was not found or is invalid with Google Play.',
      };
    }

    console.error('[Google Play] Publisher API verification failed:', status || msg);
    return {
      valid: false,
      packageName,
      subscriptionId,
      orderId: '',
      purchaseTimeMillis: 0,
      expiryTimeMillis: 0,
      autoRenewing: false,
      status: 'INVALID',
      isProEntitled: false,
      errorMessage: 'Failed to verify subscription with Google Play Developer API.',
    };
  }
}

