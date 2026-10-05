import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker to use CDN with robust fallback for browser and mobile environments
if (typeof window !== 'undefined') {
  try {
    const version = pdfjsLib.version || '4.0.379';
    // unpkg provides the exact npm version matching package.json
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  } catch {
    // Ignore worker setup failure
  }
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
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBuffer,
    cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;
  if (onTotalPages) {
    onTotalPages(pdf.numPages);
  }
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
