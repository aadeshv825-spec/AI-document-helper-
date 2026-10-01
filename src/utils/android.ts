
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

    onNativeGoogleSignInSuccess?: (data: {
      idToken: string;
      email: string;
      displayName: string;
      photoUrl: string;
    }) => void;

    onNativeGoogleSignInError?: (data: {
      error: string;
      code: string;
    }) => void;
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
 * Automatically reports a timeout if Android does not respond.
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

    bridge.launchGoogleSignIn(clientId);

    window.setTimeout(() => {
      const timeoutError = {
        error: 'Google Sign-In timed out. Please try again.',
        code: 'TIMEOUT',
      };

      window.dispatchEvent(
        new CustomEvent('onNativeGoogleSignInError', {
          detail: timeoutError,
        })
      );

      window.onNativeGoogleSignInError?.(timeoutError);
    }, 60000);

    return true;
  } catch (error) {
    console.error('Native Google Sign-In launch failed:', error);
    return false;
  }
}

/**
 * Checks whether the app is executing inside the native Android container.
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

  // Fallback to clipboard.
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
