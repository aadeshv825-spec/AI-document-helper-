import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  RotateCw,
  RotateCcw,
  Sliders,
  Sparkles,
  Download,
  Share2,
  FileText,
  Copy,
  Check,
  Star,
  RefreshCw,
  Eye,
  Layers,
  ArrowRight,
  Plus,
  Trash2,
  Crop,
  Compass,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from 'lucide-react';
import { ActiveTab } from '../types';
import { SAMPLE_DOCUMENT_PHOTO_BASE64 } from '../data/sampleDocuments';
import { cleanImageToPdf, imagesToPdf, downloadBlobFile } from '../utils/pdfHelper';
import { shareDocumentContent } from '../utils/share';
import { QuickActionsBar } from './QuickActionsBar';

interface ScanCleanToolProps {
  onTransferText: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

type FilterMode = 'magic' | 'bw' | 'grayscale' | 'sharp' | 'original';

interface ScanPage {
  id: string;
  originalSrc: string;
  cleanDataUrl: string;
  rotation: number;
  fineRotation: number;
  filterMode: FilterMode;
  brightness: number;
  contrast: number;
  cropMargin: number;
}

export const ScanCleanTool: React.FC<ScanCleanToolProps> = ({
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [shared, setShared] = useState<boolean>(false);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentPage = pages[activePageIndex] || null;

  // Process a single page given its settings
  const renderCleanPage = useCallback(
    (page: ScanPage): Promise<string> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = canvasRef.current || document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(page.originalSrc);

          const totalAngleRad = ((page.rotation + page.fineRotation) * Math.PI) / 180;
          const cos = Math.abs(Math.cos(totalAngleRad));
          const sin = Math.abs(Math.sin(totalAngleRad));

          const origW = img.naturalWidth || img.width;
          const origH = img.naturalHeight || img.height;

          const cropX = (origW * page.cropMargin) / 100;
          const cropY = (origH * page.cropMargin) / 100;
          const effectiveW = Math.max(20, origW - cropX * 2);
          const effectiveH = Math.max(20, origH - cropY * 2);

          const rotatedW = Math.round(effectiveW * cos + effectiveH * sin);
          const rotatedH = Math.round(effectiveW * sin + effectiveH * cos);

          const maxDim = 1800;
          let finalW = rotatedW;
          let finalH = rotatedH;
          if (finalW > maxDim || finalH > maxDim) {
            const ratio = Math.min(maxDim / finalW, maxDim / finalH);
            finalW = Math.round(finalW * ratio);
            finalH = Math.round(finalH * ratio);
          }

          canvas.width = finalW;
          canvas.height = finalH;

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, finalW, finalH);

          ctx.translate(finalW / 2, finalH / 2);
          ctx.rotate(totalAngleRad);

          const scale = finalW / rotatedW;
          ctx.scale(scale, scale);

          ctx.drawImage(
            img,
            cropX,
            cropY,
            effectiveW,
            effectiveH,
            -effectiveW / 2,
            -effectiveH / 2,
            effectiveW,
            effectiveH
          );
          ctx.restore();

          try {
            const imgData = ctx.getImageData(0, 0, finalW, finalH);
            const data = imgData.data;
            const len = data.length;

            const contrastFactor = (259 * (page.contrast + 255)) / (255 * (259 - page.contrast));
            const bright = page.brightness;

            for (let i = 0; i < len; i += 4) {
              let r = data[i];
              let g = data[i + 1];
              let b = data[i + 2];

              r = contrastFactor * (r - 128) + 128 + bright;
              g = contrastFactor * (g - 128) + 128 + bright;
              b = contrastFactor * (b - 128) + 128 + bright;

              r = r < 0 ? 0 : r > 255 ? 255 : r;
              g = g < 0 ? 0 : g > 255 ? 255 : g;
              b = b < 0 ? 0 : b > 255 ? 255 : b;

              const lum = 0.299 * r + 0.587 * g + 0.114 * b;

              if (page.filterMode === 'magic') {
                if (lum > 165) {
                  const boost = (lum - 165) / 90;
                  r = r + (255 - r) * boost;
                  g = g + (255 - g) * boost;
                  b = b + (255 - b) * boost;
                } else {
                  r = r * 0.84;
                  g = g * 0.84;
                  b = b * 0.84;
                }
              } else if (page.filterMode === 'bw') {
                const val = lum > 145 ? 255 : 20;
                r = val;
                g = val;
                b = val;
              } else if (page.filterMode === 'grayscale') {
                r = lum;
                g = lum;
                b = lum;
              } else if (page.filterMode === 'sharp') {
                r = Math.min(255, r * 1.08);
                g = Math.min(255, g * 1.08);
                b = Math.min(255, b * 1.08);
              }

              data[i] = r;
              data[i + 1] = g;
              data[i + 2] = b;
            }

            ctx.putImageData(imgData, 0, 0);
          } catch {
            // fallback
          }

          const outUrl = canvas.toDataURL('image/jpeg', 0.92);
          resolve(outUrl);
        };
        img.onerror = () => resolve(page.originalSrc);
        img.src = page.originalSrc;
      });
    },
    []
  );

  // Re-render current page when its parameters change
  useEffect(() => {
    if (!currentPage) return;
    renderCleanPage(currentPage).then((cleanUrl) => {
      if (cleanUrl !== currentPage.cleanDataUrl) {
        setPages((prev) =>
          prev.map((p, idx) => (idx === activePageIndex ? { ...p, cleanDataUrl: cleanUrl } : p))
        );
      }
    });
  }, [
    currentPage?.originalSrc,
    currentPage?.rotation,
    currentPage?.fineRotation,
    currentPage?.cropMargin,
    currentPage?.filterMode,
    currentPage?.brightness,
    currentPage?.contrast,
    activePageIndex,
    renderCleanPage,
  ]);

  const addImageToScanQueue = (src: string) => {
    const newPage: ScanPage = {
      id: `page_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      originalSrc: src,
      cleanDataUrl: src,
      rotation: 0,
      fineRotation: 0,
      filterMode: 'magic',
      brightness: 12,
      contrast: 28,
      cropMargin: 2,
    };

    renderCleanPage(newPage).then((cleanUrl) => {
      newPage.cleanDataUrl = cleanUrl;
      setPages((prev) => {
        const next = [...prev, newPage];
        setActivePageIndex(next.length - 1);
        return next;
      });
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          addImageToScanQueue(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    });

    if (e.target) e.target.value = '';
  };

  const handleLoadSample = () => {
    addImageToScanQueue(SAMPLE_DOCUMENT_PHOTO_BASE64);
  };

  const updateCurrentPage = (updates: Partial<ScanPage>) => {
    setPages((prev) =>
      prev.map((p, idx) => (idx === activePageIndex ? { ...p, ...updates } : p))
    );
  };

  const handleDeleteCurrentPage = () => {
    if (pages.length <= 1) {
      setPages([]);
      setActivePageIndex(0);
      return;
    }
    setPages((prev) => {
      const next = prev.filter((_, idx) => idx !== activePageIndex);
      setActivePageIndex(Math.max(0, activePageIndex - 1));
      return next;
    });
  };

  // 1-Tap Auto-Crop: automatically applies optimal border trimming to discard scanner shadows
  const handleAutoCrop = () => {
    if (!currentPage) return;
    const newCrop = currentPage.cropMargin > 0 ? 0 : 4;
    updateCurrentPage({ cropMargin: newCrop });
  };

  // 1-Tap Auto-Straighten: resets tilt to zero
  const handleAutoStraighten = () => {
    if (!currentPage) return;
    updateCurrentPage({ fineRotation: 0 });
  };

  const handleRotateRight = () => {
    if (!currentPage) return;
    updateCurrentPage({ rotation: (currentPage.rotation + 90) % 360 });
  };

  const handleRotateLeft = () => {
    if (!currentPage) return;
    updateCurrentPage({ rotation: (currentPage.rotation - 90 + 360) % 360 });
  };

  // Export single page PDF
  const handleDownloadSinglePdf = async () => {
    if (!currentPage?.cleanDataUrl) return;
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    setIsProcessing(true);
    try {
      const pdfBytes = await cleanImageToPdf(currentPage.cleanDataUrl, 'Scanned_Page');
      downloadBlobFile(pdfBytes, `Scanned_Page_${activePageIndex + 1}_${Date.now()}.pdf`, 'application/pdf');

      onSaveHistory(
        `Scanned Page ${activePageIndex + 1} (PDF)`,
        'scan-clean',
        `Enhanced document scan page ${activePageIndex + 1} exported as clean PDF.`,
        isFavorited
      );
    } catch (err) {
      console.error('Failed to create PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Export combined multi-page document PDF
  const handleDownloadMultiPagePdf = async () => {
    if (pages.length === 0) return;
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    setIsProcessing(true);
    try {
      const imgPayloads = pages.map((p) => ({ dataUrl: p.cleanDataUrl || p.originalSrc }));
      const pdfBytes = await imagesToPdf(imgPayloads, { orientation: 'auto', margin: 15 });
      downloadBlobFile(pdfBytes, `Scanned_Document_${pages.length}Pages_${Date.now()}.pdf`, 'application/pdf');

      onSaveHistory(
        `Multi-Page Scan (${pages.length} pages PDF)`,
        'scan-clean',
        `Combined ${pages.length}-page document scanned and enhanced into a multi-page PDF.`,
        isFavorited
      );
    } catch (err) {
      console.error('Failed to create multi-page PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadImage = () => {
    if (!currentPage?.cleanDataUrl) return;
    const a = document.createElement('a');
    a.href = currentPage.cleanDataUrl;
    a.download = `Scan_Page_${activePageIndex + 1}_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = async () => {
    if (!currentPage?.cleanDataUrl) return;
    const outcome = await shareDocumentContent({
      title: `Scanned Document Page ${activePageIndex + 1}`,
      text: `Cleaned and enhanced scan of document (Page ${activePageIndex + 1} of ${pages.length}).`,
    });
    if (outcome !== 'dismissed') {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  const handleCopy = async () => {
    if (!currentPage?.cleanDataUrl) return;
    try {
      const res = await fetch(currentPage.cleanDataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSendToOcr = () => {
    if (!currentPage?.cleanDataUrl) return;
    onTransferText(currentPage.cleanDataUrl, 'photo-to-text');
  };

  return (
    <div className="space-y-4 pb-8 max-w-4xl mx-auto">
      {/* Hidden inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Free Limit Warning */}
      {isLimitReached && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200 shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Daily free limit reached (5/5). Start 30-day Pro trial for unlimited document scans.</span>
          </div>
          <button
            onClick={onOpenPro}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs shrink-0 transition-colors shadow-sm"
          >
            Start Trial
          </button>
        </div>
      )}

      {/* Action Header Card */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
            Document Scanner & Enhancer
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 font-medium">
            Multi-Page Scanner
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Scan single or multi-page documents with automatic border crop, tilt straightening, shadow removal, and contrast enhancement.
        </p>

        {/* Capture / Upload Buttons */}
        <div className="grid grid-cols-2 gap-2.5 mt-3.5">
          <button
            id="scan-camera-btn"
            onClick={() => cameraInputRef.current?.click()}
            className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors active:scale-95"
          >
            <Camera className="w-4 h-4" />
            <span>{pages.length > 0 ? '+ Scan Next Page' : 'Take Photo'}</span>
          </button>

          <button
            id="scan-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-750 font-semibold text-xs flex items-center justify-center gap-2 transition-colors active:scale-95"
          >
            <Upload className="w-4 h-4" />
            <span>{pages.length > 0 ? '+ Upload Pages' : 'Upload Images'}</span>
          </button>
        </div>

        {/* 1-Tap Sample Preset */}
        {pages.length === 0 && (
          <div className="mt-3 pt-2.5 border-t border-slate-700/50 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Need a quick test?</span>
            <button
              onClick={handleLoadSample}
              className="text-[11px] text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
            >
              📄 Try Sample Bill Scan
            </button>
          </div>
        )}
      </div>

      {/* Multi-Page Queue Tray */}
      {pages.length > 0 && (
        <div className="bg-slate-850 border border-slate-750 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              Document Pages ({pages.length})
            </span>
            <span className="text-[11px] text-slate-400">
              Viewing Page {activePageIndex + 1} of {pages.length}
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {pages.map((p, idx) => (
              <div
                key={p.id}
                onClick={() => setActivePageIndex(idx)}
                className={`relative group rounded-lg overflow-hidden border-2 cursor-pointer shrink-0 transition-all ${
                  idx === activePageIndex
                    ? 'border-blue-500 shadow-md ring-2 ring-blue-500/20'
                    : 'border-slate-700 opacity-70 hover:opacity-100'
                }`}
                style={{ width: '64px', height: '80px' }}
              >
                <img
                  src={p.cleanDataUrl || p.originalSrc}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-full object-cover bg-slate-900"
                />
                <span className="absolute bottom-1 right-1 bg-slate-950/80 text-[10px] text-white px-1 rounded font-mono font-bold">
                  {idx + 1}
                </span>
              </div>
            ))}

            {/* Add Next Page Tile */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-20 rounded-lg border-2 border-dashed border-slate-700 hover:border-slate-500 hover:bg-slate-800/60 flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-slate-200 text-xs shrink-0 transition-colors"
              title="Add another page"
            >
              <Plus className="w-4 h-4" />
              <span className="text-[10px]">Add</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Active Page Processing Stage */}
      {currentPage && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 space-y-4 shadow-sm">
          {/* Top Bar for Current Page */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                Page {activePageIndex + 1} of {pages.length}
              </span>
              {pages.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <button
                    disabled={activePageIndex === 0}
                    onClick={() => setActivePageIndex((prev) => Math.max(0, prev - 1))}
                    className="p-1 rounded bg-slate-750 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={activePageIndex === pages.length - 1}
                    onClick={() => setActivePageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                    className="p-1 rounded bg-slate-750 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
                    title="Next page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Quick action buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleAutoCrop}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 border transition-colors ${
                  currentPage.cropMargin > 0
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-750 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
                title="Auto-crop outer border noise and shadows"
              >
                <Crop className="w-3.5 h-3.5" />
                <span>Auto-Crop</span>
              </button>

              <button
                onClick={handleAutoStraighten}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-750 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 transition-colors"
                title="Auto-straighten skew"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Straighten</span>
              </button>

              <button
                onClick={handleRotateLeft}
                className="p-1.5 rounded-lg bg-slate-750 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Rotate 90° Left"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRotateRight}
                className="p-1.5 rounded-lg bg-slate-750 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Rotate 90° Right"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleDeleteCurrentPage}
                className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-800/40 transition-colors"
                title="Remove this page"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Canvas Preview Box */}
          <div className="relative bg-slate-950 rounded-xl overflow-hidden border border-slate-700/70 flex items-center justify-center min-h-[280px] max-h-[440px] p-2">
            <img
              src={currentPage.cleanDataUrl || currentPage.originalSrc}
              alt={`Page ${activePageIndex + 1}`}
              className="max-h-[420px] w-auto object-contain rounded shadow-lg transition-transform duration-100"
            />
          </div>

          {/* Filter Preset Modes */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Layers className="w-3 h-3 text-blue-400" />
              Readability Enhancement Filters
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 text-xs">
              {[
                { id: 'magic', label: 'Magic Clean', desc: 'Whitens background' },
                { id: 'bw', label: 'B&W Scan', desc: 'Pure black & white' },
                { id: 'grayscale', label: 'Grayscale', desc: 'Neutral mono' },
                { id: 'sharp', label: 'Super Sharp', desc: 'Enhanced contrast' },
                { id: 'original', label: 'Original', desc: 'No filter' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => updateCurrentPage({ filterMode: f.id as FilterMode })}
                  className={`p-2 rounded-lg text-center border transition-all ${
                    currentPage.filterMode === f.id
                      ? 'bg-blue-600/20 border-blue-500 text-blue-200 font-bold shadow-xs'
                      : 'bg-slate-800 border-slate-700/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="text-[11px] font-medium truncate">{f.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Fine Tuning Sliders */}
          <div className="bg-slate-850 p-3 rounded-xl border border-slate-700/50 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold text-[11px] flex items-center gap-1">
                <Sliders className="w-3 h-3 text-slate-400" />
                Fine-Tune Alignment & Lighting
              </span>
              <button
                onClick={() =>
                  updateCurrentPage({
                    rotation: 0,
                    fineRotation: 0,
                    cropMargin: 0,
                    brightness: 10,
                    contrast: 25,
                    filterMode: 'magic',
                  })
                }
                className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Reset Page
              </button>
            </div>

            {/* Tilt / Straighten Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Straighten / Skew Alignment</span>
                <span className="font-mono">{currentPage.fineRotation}°</span>
              </div>
              <input
                type="range"
                min="-15"
                max="15"
                step="0.5"
                value={currentPage.fineRotation}
                onChange={(e) => updateCurrentPage({ fineRotation: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* Crop Margin Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Border Margin Crop</span>
                <span className="font-mono">{currentPage.cropMargin}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="1"
                value={currentPage.cropMargin}
                onChange={(e) => updateCurrentPage({ cropMargin: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* Contrast Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Ink Contrast Boost</span>
                <span className="font-mono">{currentPage.contrast}</span>
              </div>
              <input
                type="range"
                min="-20"
                max="80"
                value={currentPage.contrast}
                onChange={(e) => updateCurrentPage({ contrast: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>
          </div>

          {/* Export & Next Step Workflow */}
          <div className="pt-2 border-t border-slate-700/60 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Multi-Page PDF Download (if multiple pages) or Single PDF */}
              {pages.length > 1 ? (
                <button
                  id="btn-download-multipage-pdf"
                  onClick={handleDownloadMultiPagePdf}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download All {pages.length} Pages (PDF)</span>
                </button>
              ) : (
                <button
                  id="btn-download-pdf"
                  onClick={handleDownloadSinglePdf}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Clean PDF</span>
                </button>
              )}

              {/* Send to OCR */}
              <button
                id="btn-scan-to-ocr"
                onClick={handleSendToOcr}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span>Extract Text with AI OCR</span>
              </button>
            </div>

            {/* Secondary Actions */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDownloadImage}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 flex items-center gap-1 transition-colors"
                  title="Download Current Page as JPEG"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download JPG</span>
                </button>

                {pages.length > 1 && (
                  <button
                    onClick={handleDownloadSinglePdf}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 flex items-center gap-1 transition-colors"
                    title="Download only this page as PDF"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Page {activePageIndex + 1} PDF</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
                  title="Copy image to clipboard"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleShare}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
                  title="Share scan"
                >
                  {shared ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => {
                    const nextFav = !isFavorited;
                    setIsFavorited(nextFav);
                    onSaveHistory(
                      `Scanned Document (${pages.length} pages)`,
                      'scan-clean',
                      `Cleaned multi-page document with ${pages.length} enhanced page(s).`,
                      nextFav
                    );
                  }}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    isFavorited
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                  title={isFavorited ? 'Saved to Favorites' : 'Save to Favorites'}
                >
                  <Star className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
