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
    onAndroidBackPressed?: () => boolean;
  }
}

/**
 * Checks whether the app is executing inside the native Android container
 */
export function isNativeAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.AndroidBridge?.isAndroid?.()) return true;
  if (typeof navigator !== 'undefined') {
    return /AIDocumentHelperApp|Android/i.test(navigator.userAgent);
  }
  return false;
}

/**
 * Triggers native Android haptic feedback
 */
export function triggerHaptic(durationMs = 40): void {
  try {
    if (window.AndroidBridge?.vibrate) {
      window.AndroidBridge.vibrate(durationMs);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch {
    // Ignore unsupported vibration
  }
}

/**
 * Shows native Android toast or fallback
 */
export function showAndroidToast(message: string): void {
  try {
    if (window.AndroidBridge?.showToast) {
      window.AndroidBridge.showToast(message);
      return;
    }
  } catch {
    // Ignore fallback
  }
}

/**
 * Shares text via native Android Intent or Web Share API
 */
export async function shareNativeDocument(title: string, text: string): Promise<boolean> {
  try {
    if (window.AndroidBridge?.shareText) {
      window.AndroidBridge.shareText(title, text);
      return true;
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text });
      return true;
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return false;
  }

  // Fallback: clipboard
  try {
    if (window.AndroidBridge?.copyToClipboard) {
      window.AndroidBridge.copyToClipboard(text);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
