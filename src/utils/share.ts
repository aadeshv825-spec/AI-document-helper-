/**
 * Utility to share generated document text, summaries, or drafts using the Web Share API.
 * Gracefully falls back to clipboard copying if the Web Share API is unsupported or blocked.
 */
export async function shareDocumentContent(options: {
  title: string;
  text: string;
}): Promise<'shared' | 'copied' | 'dismissed'> {
  const { title, text } = options;

  // Android app: the WebView has no Web Share API, so use the native
  // share sheet provided by the app.
  if (typeof window !== 'undefined' && typeof window.AndroidBridge?.shareText === 'function') {
    try {
      window.AndroidBridge.shareText(title, text);
      return 'shared';
    } catch {
      // Fall through to the clipboard fallback.
    }
  }

  // Check if Web Share API is available and can share data
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title,
        text,
      });
      return 'shared';
    } catch (err: any) {
      // If user dismissed/aborted the native share dialog, don't fallback to clipboard
      if (err && (err.name === 'AbortError' || err.code === 20)) {
        return 'dismissed';
      }
      // If native share failed for another reason (e.g. iframe permission), fall through to clipboard
    }
  }

  // Fallback to Clipboard API
  try {
    if (typeof window !== 'undefined' && typeof window.AndroidBridge?.copyToClipboard === 'function') {
      window.AndroidBridge.copyToClipboard(text);
      return 'copied';
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch (clipErr) {
    // If clipboard fails, try fallback execCommand
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return 'copied';
    } catch {
      // ignore
    }
  }

  return 'dismissed';
}

/**
 * Copies text to the clipboard. Uses the Android app bridge when available,
 * then the Clipboard API, then a legacy fallback. Never throws.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && typeof window.AndroidBridge?.copyToClipboard === 'function') {
      window.AndroidBridge.copyToClipboard(text);
      return true;
    }
  } catch {
    // Try the next method.
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Try the legacy method.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
