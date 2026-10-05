// Real Server-to-Server Google Play Developer API (Android Publisher v3) Client
// Verifies purchase tokens, enforces package names and SKUs, retrieves authoritative
// expiry time from Google Play, and acknowledges purchases.

import fs from 'node:fs';
import { GoogleAuth, JWT } from 'google-auth-library';
import { GOOGLE_PLAY_SKUS, isValidGooglePlaySku } from './store.ts';

export const PLAY_PACKAGE_NAME = 'com.aidocumenthelper.app';

export interface GooglePlaySubscriptionResult {
  valid: boolean;
  packageName: string;
  subscriptionId: string;
  orderId: string;
  purchaseTimeMillis: number;
  expiryTimeMillis: number;
  autoRenewing: boolean;
  paymentState?: number;
  acknowledgementState?: number;
  cancelReason?: number;
  status: 'ACTIVE' | 'CANCELLED_ACTIVE' | 'EXPIRED' | 'REVOKED' | 'INVALID';
  errorMessage?: string;
  rawResponse?: any;
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
 * Verifies a subscription purchase token with the Google Play Developer API.
 * Never trusts client-supplied timestamps or order IDs.
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
      errorMessage: 'Purchase token cannot be empty.',
    };
  }

  // 4. If mock verifier is configured in-process, use it
  if (mockVerifier) {
    return mockVerifier(packageName, subscriptionId, cleanToken);
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
            return fileMocks[cleanToken];
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // 5. Query official Google Play Android Publisher v3 API
  try {
    const auth = getAuthClient();
    const client = await auth.getClient();

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      packageName
    )}/purchases/subscriptions/${encodeURIComponent(subscriptionId)}/tokens/${encodeURIComponent(cleanToken)}`;

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
        errorMessage: 'Empty response received from Google Play Developer API.',
      };
    }

    const startTimeMillis = Number(data.startTimeMillis || Date.now());
    const expiryTimeMillis = Number(data.expiryTimeMillis || 0);
    const autoRenewing = Boolean(data.autoRenewing);
    const paymentState = data.paymentState !== undefined ? Number(data.paymentState) : undefined;
    const acknowledgementState = data.acknowledgementState !== undefined ? Number(data.acknowledgementState) : undefined;
    const cancelReason = data.cancelReason !== undefined ? Number(data.cancelReason) : undefined;
    const orderId = data.orderId || `GPA.PLAY-${cleanToken.slice(0, 8)}`;

    const now = Date.now();

    // Check expiry
    if (expiryTimeMillis <= now) {
      return {
        valid: false,
        packageName,
        subscriptionId,
        orderId,
        purchaseTimeMillis: startTimeMillis,
        expiryTimeMillis,
        autoRenewing,
        paymentState,
        acknowledgementState,
        cancelReason,
        status: 'EXPIRED',
        errorMessage: 'Subscription has expired according to Google Play records.',
        rawResponse: data,
      };
    }

    // Check cancellation / revocation
    // cancelReason 3: Developer canceled / refunded
    // cancelReason 1: System canceled
    if (cancelReason === 3) {
      return {
        valid: false,
        packageName,
        subscriptionId,
        orderId,
        purchaseTimeMillis: startTimeMillis,
        expiryTimeMillis,
        autoRenewing,
        paymentState,
        acknowledgementState,
        cancelReason,
        status: 'REVOKED',
        errorMessage: 'Subscription has been refunded or revoked.',
        rawResponse: data,
      };
    }

    // Check payment pending
    if (paymentState === 0) {
      return {
        valid: false,
        packageName,
        subscriptionId,
        orderId,
        purchaseTimeMillis: startTimeMillis,
        expiryTimeMillis,
        autoRenewing,
        paymentState,
        acknowledgementState,
        cancelReason,
        status: 'INVALID',
        errorMessage: 'Payment is pending with Google Play.',
        rawResponse: data,
      };
    }

    // Auto-acknowledge unacknowledged subscription if payment was received
    if (acknowledgementState === 0) {
      try {
        const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
          packageName
        )}/purchases/subscriptions/${encodeURIComponent(subscriptionId)}/tokens/${encodeURIComponent(cleanToken)}:acknowledge`;
        await client.request({
          url: ackUrl,
          method: 'POST',
          data: { developerPayload: '' },
        });
      } catch (ackErr: any) {
        console.warn('[Google Play] Non-fatal acknowledgement warning:', ackErr?.message);
      }
    }

    const status = cancelReason === 0 ? 'CANCELLED_ACTIVE' : 'ACTIVE';

    return {
      valid: true,
      packageName,
      subscriptionId,
      orderId,
      purchaseTimeMillis: startTimeMillis,
      expiryTimeMillis,
      autoRenewing,
      paymentState,
      acknowledgementState: 1,
      cancelReason,
      status,
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
      errorMessage: 'Failed to verify subscription with Google Play Developer API.',
    };
  }
}
