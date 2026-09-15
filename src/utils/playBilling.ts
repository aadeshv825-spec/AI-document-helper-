import { logger } from './logger';

export const PLAY_STORE_SKUS = {
  MONTHLY: 'ai_doc_pro_monthly',
  ANNUAL: 'ai_doc_pro_annual',
} as const;

export type PlayStoreSku = typeof PLAY_STORE_SKUS[keyof typeof PLAY_STORE_SKUS];

export interface PlayBillingProduct {
  sku: PlayStoreSku;
  title: string;
  description: string;
  price: string;
  period: 'monthly' | 'annual';
}

export const PLAY_STORE_PRODUCTS: PlayBillingProduct[] = [
  {
    sku: PLAY_STORE_SKUS.MONTHLY,
    title: 'Document Helper Pro - Monthly',
    description: 'Unlimited AI processing, high-accuracy OCR, Hindi translation & PDF tools',
    price: '₹99',
    period: 'monthly',
  },
  {
    sku: PLAY_STORE_SKUS.ANNUAL,
    title: 'Document Helper Pro - Annual',
    description: 'Unlimited AI processing, high-accuracy OCR, Hindi translation & PDF tools (Save 41%)',
    price: '₹699',
    period: 'annual',
  },
];

declare global {
  interface Window {
    AndroidPlayBilling?: {
      isAvailable?: () => boolean;
      launchBillingFlow?: (sku: string, accountId?: string) => void | Promise<any>;
      queryPurchases?: () => string | Promise<string>;
    };
    AndroidBridge?: any;
    isPlayStoreApp?: boolean;
    getDigitalGoodsService?: (serviceProvider: string) => Promise<any>;
    onGooglePlayPurchaseCompleted?: (purchaseData: any) => void;
  }
}

/**
 * Detects whether the current session is executing inside an Android Google Play container
 * (Trusted Web Activity, Capacitor Android wrapper, or native WebView bridge).
 */
export function isAndroidPlayStoreEnvironment(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Check for native Android JavaScript interface
  if (window.AndroidPlayBilling || window.AndroidBridge || window.isPlayStoreApp) {
    return true;
  }

  // 2. Check for Play Store TWA query or user agent markers
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('utm_source') === 'playstore' || urlParams.get('twa') === '1') {
    return true;
  }

  // 3. Check for standalone Android PWA/TWA
  const isAndroid = /android/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  return isAndroid && isStandalone;
}

/**
 * Checks if the W3C Digital Goods API for Google Play Billing is available (TWA).
 */
export function isDigitalGoodsSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.getDigitalGoodsService === 'function';
}

/**
 * Checks if the native AndroidPlayBilling JavaScript interface is available.
 */
export function isNativePlayBillingSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.AndroidPlayBilling);
}

export interface PurchaseVerificationResponse {
  success: boolean;
  message?: string;
  error?: string;
  user?: any;
  usage?: any;
}

/**
 * Sends a Google Play purchase token to the backend server for verification
 * and automatic Pro tier activation.
 */
export async function verifyAndActivatePlayPurchase(
  params: {
    purchaseToken: string;
    sku: string;
    orderId?: string;
    packageName?: string;
  },
  authHeaders: Record<string, string>
): Promise<PurchaseVerificationResponse> {
  try {
    const res = await fetch('/api/billing/google-play/verify-purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        purchaseToken: params.purchaseToken,
        sku: params.sku,
        orderId: params.orderId,
        packageName: params.packageName || 'com.aidocumenthelper.app',
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: data.error || 'Failed to verify Google Play purchase.',
      };
    }

    logger.info('Google Play Pro subscription successfully activated', {
      sku: params.sku,
      orderId: params.orderId,
    });

    return {
      success: true,
      message: data.message || 'Pro membership activated successfully!',
      user: data.user,
      usage: data.usage,
    };
  } catch (err: any) {
    logger.error('Error verifying Google Play purchase with backend', err);
    return {
      success: false,
      error: 'Network connection error while verifying Google Play purchase.',
    };
  }
}

/**
 * Restores existing Google Play purchases by verifying them against the server.
 */
export async function restorePlayPurchases(
  authHeaders: Record<string, string>,
  purchaseTokens?: string[]
): Promise<{ success: boolean; restored: boolean; message: string; user?: any; usage?: any }> {
  try {
    // If native bridge can provide existing purchase tokens, query them
    let deviceTokens = purchaseTokens || [];
    if (deviceTokens.length === 0 && window.AndroidPlayBilling?.queryPurchases) {
      try {
        const raw = await window.AndroidPlayBilling.queryPurchases();
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            deviceTokens = parsed.map((p) => p.purchaseToken || p.token).filter(Boolean);
          }
        }
      } catch (e) {
        logger.warn('Could not query local AndroidPlayBilling purchases', e);
      }
    }

    const res = await fetch('/api/billing/google-play/restore-purchases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ purchaseTokens: deviceTokens }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        restored: false,
        message: data.error || 'Failed to restore purchases.',
      };
    }

    return {
      success: true,
      restored: Boolean(data.restored),
      message: data.message,
      user: data.user,
      usage: data.usage,
    };
  } catch (err: any) {
    logger.error('Error restoring Google Play purchases', err);
    return {
      success: false,
      restored: false,
      message: 'Network error while attempting to restore Google Play purchases.',
    };
  }
}

/**
 * Initiates the Google Play purchase flow.
 * - If running in Android with Google Play Billing: launches the official billing sheet.
 * - If running in web preview: informs the user that Google Play Billing will execute in the Android build.
 */
export async function initiatePlayPurchase(
  sku: PlayStoreSku,
  userId: string | undefined,
  authHeaders: Record<string, string>,
  onSuccess: (result: PurchaseVerificationResponse) => void,
  onError: (errorMsg: string) => void
): Promise<void> {
  // 1. Android Native WebView / Capacitor Bridge Flow
  if (window.AndroidPlayBilling?.launchBillingFlow) {
    try {
      // Set up completion listener
      window.onGooglePlayPurchaseCompleted = async (purchaseData: any) => {
        try {
          const token = typeof purchaseData === 'string' ? purchaseData : purchaseData?.purchaseToken || purchaseData?.token;
          const orderId = purchaseData?.orderId;
          const res = await verifyAndActivatePlayPurchase(
            {
              purchaseToken: token,
              sku,
              orderId,
            },
            authHeaders
          );
          if (res.success) {
            onSuccess(res);
          } else {
            onError(res.error || 'Verification failed');
          }
        } catch (e: any) {
          onError(e.message || 'Purchase completion error');
        }
      };

      await window.AndroidPlayBilling.launchBillingFlow(sku, userId);
      return;
    } catch (err: any) {
      logger.error('Error invoking AndroidPlayBilling bridge', err);
      onError(err.message || 'Could not launch Google Play billing.');
      return;
    }
  }

  // 2. W3C Digital Goods API (TWA in Chrome / Google Play)
  if (isDigitalGoodsSupported()) {
    try {
      const digitalGoodsService = await window.getDigitalGoodsService!('https://play.google.com/billing');
      if (digitalGoodsService) {
        const paymentDetails = {
          total: {
            label: 'Total',
            amount: { currency: 'INR', value: sku === PLAY_STORE_SKUS.ANNUAL ? '699.00' : '99.00' },
          },
        };

        const paymentMethods = [
          {
            supportedMethods: 'https://play.google.com/billing',
            data: { sku },
          },
        ];

        const request = new PaymentRequest(paymentMethods, paymentDetails);
        const paymentResponse = await request.show();
        const purchaseToken = paymentResponse.details?.purchaseToken;

        if (purchaseToken) {
          const verification = await verifyAndActivatePlayPurchase(
            {
              purchaseToken,
              sku,
            },
            authHeaders
          );

          await paymentResponse.complete(verification.success ? 'success' : 'fail');

          if (verification.success) {
            onSuccess(verification);
          } else {
            onError(verification.error || 'Purchase verification failed.');
          }
          return;
        }
      }
    } catch (err: any) {
      logger.error('Digital goods purchase error', err);
      onError(err.message || 'Google Play purchase cancelled or failed.');
      return;
    }
  }

  // 3. Web Environment (Play Billing not natively available in browser)
  onError(
    'Google Play Billing requires the Android application build. When running in the Android app, Google Play in-app checkout activates automatically.'
  );
}
