import { PDFDocument } from 'pdf-lib';

/**
 * Merges multiple PDF byte arrays into a single unified PDF document.
 */
export async function mergePdfDocuments(pdfBuffers: Uint8Array[]): Promise<Uint8Array> {
  if (pdfBuffers.length === 0) {
    throw new Error('At least one PDF file is required to merge.');
  }

  const mergedPdf = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return await mergedPdf.save();
}

/**
 * Extracts specific 1-indexed pages from a PDF document into a new PDF.
 */
export async function splitPdfDocument(
  pdfBuffer: Uint8Array,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const sourcePdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = sourcePdf.getPageCount();

  const validZeroBasedIndices = pageNumbers
    .map((p) => p - 1)
    .filter((idx) => idx >= 0 && idx < totalPages);

  if (validZeroBasedIndices.length === 0) {
    throw new Error('No valid pages were selected for extraction.');
  }

  const outputPdf = await PDFDocument.create();
  const copiedPages = await outputPdf.copyPages(sourcePdf, validZeroBasedIndices);
  copiedPages.forEach((page) => outputPdf.addPage(page));

  return await outputPdf.save();
}

/**
 * Gets total page count of a PDF file.
 */
export async function getPdfPageCount(pdfBuffer: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}

/**
 * Converts an image dataUrl (including WebP, BMP, etc.) into true JPEG or PNG bytes for pdf-lib.
 */
async function ensureJpegOrPngBytes(dataUrl: string): Promise<{ isPng: boolean; bytes: Uint8Array }> {
  if (dataUrl.startsWith('data:image/png')) {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return { isPng: true, bytes };
  }

  // If already strict JPEG with SOI header
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    const base64Data = dataUrl.replace(/^data:image\/jpe?g;base64,/, '');
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return { isPng: false, bytes };
    }
  }

  // Convert WebP / other formats cleanly via canvas to standard JPEG
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas context unavailable');
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        const jpegUrl = canvas.toDataURL('image/jpeg', 0.92);
        const base64 = jpegUrl.replace(/^data:image\/jpeg;base64,/, '');
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        resolve({ isPng: false, bytes });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for PDF conversion'));
    img.src = dataUrl;
  });
}

/**
 * Converts an array of image data URLs into a formatted multipage PDF.
 */
export async function imagesToPdf(
  images: { dataUrl: string; width?: number; height?: number }[],
  options: {
    orientation?: 'auto' | 'portrait' | 'landscape';
    margin?: number;
  } = {}
): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new Error('Please provide at least one image.');
  }

  const { orientation = 'auto', margin = 20 } = options;
  const pdfDoc = await PDFDocument.create();

  for (const imgItem of images) {
    const dataUrl = imgItem.dataUrl;
    const { isPng, bytes } = await ensureJpegOrPngBytes(dataUrl);
    const embeddedImg = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);

    const imgWidth = embeddedImg.width;
    const imgHeight = embeddedImg.height;

    // Standard A4 dimensions in points: 595.28 x 841.89
    let pageWidth = 595.28;
    let pageHeight = 841.89;

    if (orientation === 'landscape' || (orientation === 'auto' && imgWidth > imgHeight)) {
      pageWidth = 841.89;
      pageHeight = 595.28;
    }

    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;

    const scale = Math.min(availableWidth / imgWidth, availableHeight / imgHeight, 1);
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const x = (pageWidth - scaledWidth) / 2;
    const y = (pageHeight - scaledHeight) / 2;

    page.drawImage(embeddedImg, {
      x,
      y,
      width: scaledWidth,
      height: scaledHeight,
    });
  }

  return await pdfDoc.save();
}

/**
 * Creates a clean single-page PDF from a processed document image.
 */
export async function cleanImageToPdf(
  imageDataUrl: string,
  _title: string = 'Scanned Document'
): Promise<Uint8Array> {
  return imagesToPdf([{ dataUrl: imageDataUrl }], {
    orientation: 'auto',
    margin: 15,
  });
}

/**
 * Downloads a Uint8Array as a file in the browser.
 */
export function downloadBlobFile(bytes: Uint8Array, fileName: string, mimeType: string = 'application/pdf') {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
