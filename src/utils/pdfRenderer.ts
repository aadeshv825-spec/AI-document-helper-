import * as pdfjsLib from 'pdfjs-dist';
// Bundle the PDF.js worker with the app so PDF tools also work offline
// and inside the Android app (no dependency on an external CDN).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface RenderedPdfPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Renders all pages of a PDF buffer into image data URLs using pdfjs-dist.
 */
export async function renderPdfToImages(
  pdfBuffer: Uint8Array,
  scale: number = 1.5,
  maxPages: number = 20,
  onTotalPages?: (totalPages: number) => void
): Promise<RenderedPdfPage[]> {
  // PDF.js transfers the buffer to its worker, which would empty the
  // caller's copy; pass a copy so the original file can be reused.
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBuffer.slice(),
    cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;

  try {
    onTotalPages?.(pdf.numPages);

    const numPages = Math.min(pdf.numPages, maxPages);
    const pages: RenderedPdfPage[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Your device could not prepare the page image.');
      }

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // White background so transparent pages are not rendered black in JPEG.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const renderContext = {
        canvas: canvas,
        canvasContext: context,
        viewport: viewport,
      };

      await (page.render(renderContext as any) as any).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      pages.push({
        pageNumber: pageNum,
        dataUrl,
        width: viewport.width,
        height: viewport.height,
      });

      // Release memory used by the page and canvas.
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }

    return pages;
  } finally {
    try {
      await pdf.destroy();
    } catch {
      // ignore
    }
  }
}
