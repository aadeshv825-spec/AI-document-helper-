/**
 * Utility to download text or data as a local file in browser
 */
export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType: string = 'text/plain;charset=utf-8'
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
