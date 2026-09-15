import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker to use CDN for browser compatibility in Vite environment
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
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
  maxPages: number = 20
): Promise<RenderedPdfPage[]> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBuffer,
    cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;
  const numPages = Math.min(pdf.numPages, maxPages);
  const pages: RenderedPdfPage[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

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
  }

  return pages;
}
