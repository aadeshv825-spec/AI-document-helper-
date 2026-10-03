/**
 * Saves generated files (text, PDF, images) on the user's device.
 *
 * Android WebView ignores <a download> links and cannot download blob:
 * URLs, so inside the Android app files are handed to the native bridge,
 * which saves them to Downloads (or opens the share sheet on older
 * Android versions). Browsers use a normal download link.
 */

declare global {
  interface Window {
    AndroidFileBridge?: {
      saveFile?: (base64Data: string, fileName: string, mimeType: string) => string;
    };
  }
}

export type SaveResult = 'saved' | 'shared' | 'downloaded' | 'failed';

// Keeps letters in any script (e.g. Hindi), digits, spaces, dots,
// dashes and underscores; removes characters that are invalid in file
// names on Android/Windows.
export function sanitizeFileName(name: string, fallback = 'document'): string {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 120);

  return cleaned || fallback;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file data.'));
    reader.readAsDataURL(blob);
  });
}

function browserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke later: revoking immediately can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function saveBlobToDevice(blob: Blob, fileName: string): Promise<SaveResult> {
  const nativeSave = window.AndroidFileBridge?.saveFile;

  if (typeof nativeSave === 'function') {
    try {
      const base64 = await blobToBase64(blob);
      const result = nativeSave(base64, fileName, blob.type || 'application/octet-stream');
      return result === 'saved' || result === 'shared' ? result : 'failed';
    } catch {
      return 'failed';
    }
  }

  try {
    browserDownload(blob, fileName);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/**
 * Utility to download text or data as a local file.
 */
export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType: string = 'text/plain;charset=utf-8'
): Promise<SaveResult> {
  const blob = new Blob([content], { type: mimeType });
  return saveBlobToDevice(blob, fileName);
}

/**
 * Downloads an image or other file provided as a data: URL.
 */
export async function downloadDataUrl(dataUrl: string, fileName: string): Promise<SaveResult> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return saveBlobToDevice(blob, fileName);
  } catch {
    return 'failed';
  }
}
