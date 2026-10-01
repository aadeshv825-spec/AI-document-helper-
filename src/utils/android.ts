/**
 * Native Android integration utilities and bridge helpers.
 */

declare global {
  interface Window {
    AndroidBridge?: {
      isAndroid?: () => boolean;
      getAppVersion?: () => string;
      vibrate?: (durationMs: number) => void;
      showToast?: (message: string) => void;
      shareText?: (title: string, text: string) => void;
      copyToClipboard?: (text: string) => void;
    };

    AndroidGoogleSignIn?: {
      isGoogleSignInSupported?: () => boolean;
      launchGoogleSignIn?: (webClientId?: string) => void;
    };

    onAndroidBackPressed?: () => boolean;
  }
}

let nativeGoogleSignInTimeout: number | undefined;

/**
 * Cancels the pending Google Sign-In timeout.
 */
export function cancelNativeGoogleSignInTimeout(): void {
  if (
    typeof window !== 'undefined' &&
    nativeGoogleSignInTimeout !== undefined
  ) {
    window.clearTimeout(nativeGoogleSignInTimeout);
    nativeGoogleSignInTimeout = undefined;
  }
}

/**
 * Checks whether native Android Google Sign-In is available.
 */
export function isNativeGoogleSignInAvailable(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return !!window.AndroidGoogleSignIn?.isGoogleSignInSupported?.();
  } catch {
    return false;
  }
}

/**
 * Starts native Android Google Sign-In.
 */
export function launchNativeGoogleSignIn(
  clientId?: string
): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const bridge = window.AndroidGoogleSignIn;

    if (typeof bridge?.launchGoogleSignIn !== 'function') {
      return false;
    }

    cancelNativeGoogleSignInTimeout();

    bridge.launchGoogleSignIn(clientId);

    nativeGoogleSignInTimeout = window.setTimeout(() => {
      nativeGoogleSignInTimeout = undefined;

      window.dispatchEvent(
        new CustomEvent('onNativeGoogleSignInError', {
          detail: {
            error: 'Google Sign-In timed out. Please try again.',
            code: 'TIMEOUT',
          },
        })
      );
    }, 120000);

    return true;
  } catch (error) {
    cancelNativeGoogleSignInTimeout();
    console.error('Native Google Sign-In launch failed:', error);
    return false;
  }
}

/**
 * Checks whether the app is executing inside native Android.
 */
export function isNativeAndroid(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    if (window.AndroidBridge?.isAndroid?.()) return true;
  } catch {
    // Continue with user-agent detection.
  }

  if (typeof navigator !== 'undefined') {
    return /AIDocumentHelperApp|Android/i.test(navigator.userAgent);
  }

  return false;
}

/**
 * Triggers native Android haptic feedback.
 */
export function triggerHaptic(durationMs = 40): void {
  try {
    if (window.AndroidBridge?.vibrate) {
      window.AndroidBridge.vibrate(durationMs);
      return;
    }

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      navigator.vibrate(durationMs);
    }
  } catch {
    // Ignore unsupported vibration.
  }
}

/**
 * Shows native Android toast.
 */
export function showAndroidToast(message: string): void {
  try {
    if (window.AndroidBridge?.showToast) {
      window.AndroidBridge.showToast(message);
    }
  } catch {
    // Ignore unsupported toast.
  }
}

/**
 * Shares text via native Android Intent or Web Share API.
 */
export async function shareNativeDocument(
  title: string,
  text: string
): Promise<boolean> {
  try {
    if (window.AndroidBridge?.shareText) {
      window.AndroidBridge.shareText(title, text);
      return true;
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.share
    ) {
      await navigator.share({ title, text });
      return true;
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return false;
  }

  try {
    if (window.AndroidBridge?.copyToClipboard) {
      window.AndroidBridge.copyToClipboard(text);
      return true;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard unavailable.
  }

  return false;
}
