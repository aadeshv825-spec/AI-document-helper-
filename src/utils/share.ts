/**
 * Utility to share generated document text, summaries, or drafts using the Web Share API.
 * Gracefully falls back to clipboard copying if the Web Share API is unsupported or blocked.
 */
export async function shareDocumentContent(options: {
  title: string;
  text: string;
}): Promise<'shared' | 'copied' | 'dismissed'> {
  const { title, text } = options;

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
