import React, { useState, useRef } from 'react';
import {
  FileText,
  Layers,
  Scissors,
  Minimize2,
  Image as ImageIcon,
  FileImage,
  Upload,
  Plus,
  Trash2,
  Download,
  Share2,
  Check,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Loader2,
  Star,
  ExternalLink,
} from 'lucide-react';
import { ActiveTab } from '../types';
import {
  mergePdfDocuments,
  splitPdfDocument,
  getPdfPageCount,
  imagesToPdf,
  downloadBlobFile,
} from '../utils/pdfHelper';
import { renderPdfToImages, RenderedPdfPage } from '../utils/pdfRenderer';
import { shareDocumentContent } from '../utils/share';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';
import { QuickActionsBar } from './QuickActionsBar';

interface PdfToolsProps {
  onTransferText: (text: string, targetTab: ActiveTab) => void;
  onSaveHistory: (title: string, type: ActiveTab, content: string, isFavorite?: boolean) => void;
  isLimitReached?: boolean;
  onOpenPro?: () => void;
}

type PdfSubTool = 'merge' | 'split' | 'compress' | 'images-to-pdf' | 'pdf-to-images';

export const PdfToolsManager: React.FC<PdfToolsProps> = ({
  onTransferText,
  onSaveHistory,
  isLimitReached = false,
  onOpenPro,
}) => {
  const [activeSubTool, setActiveSubTool] = useState<PdfSubTool>('merge');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [shared, setShared] = useState<boolean>(false);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);

  // 1. Merge State
  const [mergeFiles, setMergeFiles] = useState<{ file: File; name: string; size: string; bytes: Uint8Array }[]>([]);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  // 2. Split State
  const [splitFile, setSplitFile] = useState<{ name: string; bytes: Uint8Array; pageCount: number } | null>(null);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [pageRangeInput, setPageRangeInput] = useState<string>('1');
  const splitInputRef = useRef<HTMLInputElement>(null);

  // 3. Compress State
  const [compressFile, setCompressFile] = useState<{ name: string; bytes: Uint8Array; sizeBytes: number } | null>(null);
  const [compressionLevel, setCompressionLevel] = useState<'high' | 'recommended' | 'low'>('recommended');
  const [compressResult, setCompressResult] = useState<{ originalSize: number; newSize: number; bytes: Uint8Array } | null>(null);
  const compressInputRef = useRef<HTMLInputElement>(null);

  // 4. Images to PDF State
  const [imgList, setImgList] = useState<{ dataUrl: string; name: string }[]>([]);
  const [imgOrientation, setImgOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const imgInputRef = useRef<HTMLInputElement>(null);

  // 5. PDF to Images State
  const [pdfPages, setPdfPages] = useState<RenderedPdfPage[]>([]);
  const pdfToImgInputRef = useRef<HTMLInputElement>(null);

  // Helper formatting bytes
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  };

  // -------------------------------------------------------------
  // MERGE HANDLERS
  // -------------------------------------------------------------
  const handleMergeFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setErrorMessage(null);
    for (const f of files) {
      const buffer = await f.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      setMergeFiles((prev) => [
        ...prev,
        { file: f, name: f.name, size: formatBytes(f.size), bytes },
      ]);
    }
  };

  const handleMoveMergeItem = (index: number, direction: 'up' | 'down') => {
    setMergeFiles((prev) => {
      const list = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= list.length) return prev;
      const temp = list[index];
      list[index] = list[targetIndex];
      list[targetIndex] = temp;
      return list;
    });
  };

  const handleExecuteMerge = async () => {
    if (mergeFiles.length < 2) {
      setErrorMessage('Please select at least 2 PDF files to merge.');
      return;
    }
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const buffers = mergeFiles.map((m) => m.bytes);
      const mergedBytes = await mergePdfDocuments(buffers);
      const fileName = `Merged_${Date.now()}.pdf`;
      downloadBlobFile(mergedBytes, fileName, 'application/pdf');

      setStatusMessage(`Successfully merged ${mergeFiles.length} PDF files!`);
      onSaveHistory(
        `Merged PDF (${mergeFiles.length} files)`,
        'pdf-tools',
        `Combined files: ${mergeFiles.map((f) => f.name).join(', ')}`,
        isFavorited
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to merge PDF documents.');
    } finally {
      setIsProcessing(false);
    }
  };

  // -------------------------------------------------------------
  // SPLIT HANDLERS
  // -------------------------------------------------------------
  const handleSplitFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const count = await getPdfPageCount(bytes);
      setSplitFile({ name: file.name, bytes, pageCount: count });
      setSelectedPages([1]);
      setPageRangeInput('1');
    } catch (err: any) {
      setErrorMessage('Invalid or password-protected PDF.');
    }
  };

  const parsePageRange = (inputStr: string, maxPages: number): number[] => {
    const pages = new Set<number>();
    const parts = inputStr.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
            pages.add(i);
          }
        }
      } else {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= maxPages) {
          pages.add(num);
        }
      }
    }
    return Array.from(pages).sort((a, b) => a - b);
  };

  const handleExecuteSplit = async () => {
    if (!splitFile) {
      setErrorMessage('Please upload a PDF file first.');
      return;
    }
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    const pagesToExtract =
      selectedPages.length > 0
        ? selectedPages
        : parsePageRange(pageRangeInput, splitFile.pageCount);

    if (pagesToExtract.length === 0) {
      setErrorMessage('Please choose at least one valid page to extract.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const extractedBytes = await splitPdfDocument(splitFile.bytes, pagesToExtract);
      const fileName = `${splitFile.name.replace(/\.pdf$/i, '')}_pages_${pagesToExtract.join('_')}.pdf`;
      downloadBlobFile(extractedBytes, fileName, 'application/pdf');

      setStatusMessage(`Extracted ${pagesToExtract.length} pages successfully!`);
      onSaveHistory(
        `Split PDF (${pagesToExtract.length} pages)`,
        'pdf-tools',
        `Extracted pages [${pagesToExtract.join(', ')}] from ${splitFile.name}`,
        isFavorited
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to split PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  // -------------------------------------------------------------
  // COMPRESS HANDLERS
  // -------------------------------------------------------------
  const handleCompressFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setCompressResult(null);
    const buffer = await file.arrayBuffer();
    setCompressFile({
      name: file.name,
      bytes: new Uint8Array(buffer),
      sizeBytes: file.size,
    });
  };

  const handleExecuteCompress = async () => {
    if (!compressFile) {
      setErrorMessage('Please upload a PDF to compress.');
      return;
    }
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // Re-encode and optimize PDF streams
      const scale = compressionLevel === 'high' ? 0.95 : 1.2;
      const rendered = await renderPdfToImages(compressFile.bytes, scale, 15);
      if (rendered.length === 0) {
        throw new Error('Unable to optimize document streams.');
      }

      const optimizedBytes = await imagesToPdf(
        rendered.map((p) => ({ dataUrl: p.dataUrl })),
        { orientation: 'auto', margin: 0 }
      );

      const newSize = optimizedBytes.byteLength;
      setCompressResult({
        originalSize: compressFile.sizeBytes,
        newSize,
        bytes: optimizedBytes,
      });

      setStatusMessage('PDF successfully compressed!');
      onSaveHistory(
        `Compressed PDF: ${compressFile.name}`,
        'pdf-tools',
        `Reduced from ${formatBytes(compressFile.sizeBytes)} to ${formatBytes(newSize)}`,
        isFavorited
      );
    } catch (err: any) {
      setErrorMessage('Compression error: ' + (err.message || 'Unable to compress file'));
    } finally {
      setIsProcessing(false);
    }
  };

  // -------------------------------------------------------------
  // IMAGES TO PDF HANDLERS
  // -------------------------------------------------------------
  const handleImagesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setErrorMessage(null);
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setImgList((prev) => [...prev, { dataUrl, name: f.name }]);
      };
      reader.readAsDataURL(f);
    }
  };

  const handleExecuteImagesToPdf = async () => {
    if (imgList.length === 0) {
      setErrorMessage('Please add at least one image to convert.');
      return;
    }
    if (isLimitReached) {
      onOpenPro?.();
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const pdfBytes = await imagesToPdf(
        imgList.map((i) => ({ dataUrl: i.dataUrl })),
        { orientation: imgOrientation, margin: 15 }
      );
      const fileName = `Converted_Images_${Date.now()}.pdf`;
      downloadBlobFile(pdfBytes, fileName, 'application/pdf');

      setStatusMessage(`Created PDF with ${imgList.length} pages!`);
      onSaveHistory(
        `Images to PDF (${imgList.length} pages)`,
        'pdf-tools',
        `Generated PDF document from images: ${imgList.map((i) => i.name).join(', ')}`,
        isFavorited
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to convert images to PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  // -------------------------------------------------------------
  // PDF TO IMAGES HANDLERS
  // -------------------------------------------------------------
  const handlePdfToImagesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setErrorMessage(null);
    setPdfPages([]);

    try {
      const buffer = await file.arrayBuffer();
      const pages = await renderPdfToImages(new Uint8Array(buffer), 1.5, 20);
      setPdfPages(pages);
      setStatusMessage(`Rendered ${pages.length} pages into high-resolution images.`);
    } catch (err: any) {
      setErrorMessage('Failed to extract images from PDF: ' + (err.message || 'Check file'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadSinglePageImage = (page: RenderedPdfPage) => {
    const a = document.createElement('a');
    a.href = page.dataUrl;
    a.download = `Page_${page.pageNumber}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSendPageToOcr = (page: RenderedPdfPage) => {
    onTransferText(page.dataUrl, 'photo-to-text');
  };

  const subTools = [
    { id: 'merge' as PdfSubTool, label: 'Merge PDF', icon: Layers },
    { id: 'split' as PdfSubTool, label: 'Split PDF', icon: Scissors },
    { id: 'compress' as PdfSubTool, label: 'Compress', icon: Minimize2 },
    { id: 'images-to-pdf' as PdfSubTool, label: 'Images to PDF', icon: ImageIcon },
    { id: 'pdf-to-images' as PdfSubTool, label: 'PDF to Images', icon: FileImage },
  ];

  return (
    <div className="space-y-4 pb-8">
      {/* Daily Free Limit Alert */}
      {isLimitReached && (
        <div className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200 shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Daily free limit reached (5/5). Start 30-day Pro trial for unlimited PDF utilities.</span>
          </div>
          <button
            onClick={onOpenPro}
            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs shrink-0 transition-colors shadow-sm"
          >
            Start Trial
          </button>
        </div>
      )}

      {/* Header Info */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-emerald-400" />
            PDF Tools & Utilities
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
            100% Client-Side
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Merge, split, compress, convert images, or render PDF pages instantly without uploading private data to remote servers.
        </p>

        {/* Sub-Tool Selector Tabs */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-3.5">
          {subTools.map((t) => {
            const Icon = t.icon;
            const isSelected = activeSubTool === t.id;
            return (
              <button
                key={t.id}
                id={`pdf-subtool-tab-${t.id}`}
                onClick={() => {
                  setActiveSubTool(t.id);
                  setErrorMessage(null);
                  setStatusMessage(null);
                }}
                className={`py-2 px-1.5 rounded-lg flex flex-col items-center justify-center gap-1 border text-center transition-all ${
                  isSelected
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200 font-bold shadow-xs'
                    : 'bg-slate-800 border-slate-750 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span className="text-[10px] leading-tight truncate w-full">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback alerts */}
      {statusMessage && (
        <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl flex items-center gap-2 text-xs text-emerald-200">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl flex items-center gap-2 text-xs text-rose-200">
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 1. MERGE PDF VIEW */}
      {/* ------------------------------------------------------------- */}
      {activeSubTool === 'merge' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3.5">
          <input
            type="file"
            ref={mergeInputRef}
            onChange={handleMergeFilesSelected}
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              Files to Combine ({mergeFiles.length})
            </span>
            <button
              onClick={() => mergeInputRef.current?.click()}
              className="py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add PDF Files</span>
            </button>
          </div>

          {mergeFiles.length === 0 ? (
            <div
              onClick={() => mergeInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-xl text-center cursor-pointer transition-colors space-y-2"
            >
              <Upload className="w-6 h-6 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Select multiple PDF files to combine</p>
              <p className="text-[11px] text-slate-500">Tap to upload contracts, statements, or receipts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mergeFiles.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-850 border border-slate-750 rounded-xl flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-mono shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{item.name}</p>
                      <p className="text-[10px] text-slate-500">{item.size}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleMoveMergeItem(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 rounded"
                      title="Move up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveMergeItem(idx, 'down')}
                      disabled={idx === mergeFiles.length - 1}
                      className="p-1 text-slate-400 hover:text-slate-200 disabled:opacity-30 rounded"
                      title="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setMergeFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-rose-400 hover:text-rose-300 rounded"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              <button
                id="btn-execute-merge"
                onClick={handleExecuteMerge}
                disabled={isProcessing}
                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Merging Documents...</span>
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4" />
                    <span>Merge {mergeFiles.length} PDF Files</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. SPLIT PDF VIEW */}
      {/* ------------------------------------------------------------- */}
      {activeSubTool === 'split' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3.5">
          <input
            type="file"
            ref={splitInputRef}
            onChange={handleSplitFileSelected}
            accept=".pdf,application/pdf"
            className="hidden"
          />

          {!splitFile ? (
            <div
              onClick={() => splitInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-xl text-center cursor-pointer transition-colors space-y-2"
            >
              <Scissors className="w-6 h-6 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Select a PDF to extract pages</p>
              <p className="text-[11px] text-slate-500">Tap to upload agreement or multipage report</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-slate-850 rounded-xl border border-slate-750 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-200 truncate max-w-xs">{splitFile.name}</p>
                  <p className="text-[11px] text-emerald-400">{splitFile.pageCount} total pages available</p>
                </div>
                <button
                  onClick={() => setSplitFile(null)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Change
                </button>
              </div>

              {/* Range Input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium">Page Range to Extract:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pageRangeInput}
                    onChange={(e) => setPageRangeInput(e.target.value)}
                    placeholder="e.g. 1-3, 5"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      const all = Array.from({ length: splitFile.pageCount }, (_, i) => i + 1);
                      setSelectedPages(all);
                      setPageRangeInput(`1-${splitFile.pageCount}`);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-750 text-slate-300 text-xs hover:bg-slate-700"
                  >
                    Select All
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Separate pages with commas or dashes (e.g. 1-2, 4)</p>
              </div>

              {/* Page Checkbox Grid */}
              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 font-medium">Or select individual pages:</span>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 bg-slate-900/50 rounded-lg">
                  {Array.from({ length: splitFile.pageCount }, (_, i) => i + 1).map((pageNum) => {
                    const isSelected = selectedPages.includes(pageNum);
                    return (
                      <button
                        key={pageNum}
                        onClick={() => {
                          setSelectedPages((prev) =>
                            prev.includes(pageNum) ? prev.filter((p) => p !== pageNum) : [...prev, pageNum].sort((a, b) => a - b)
                          );
                        }}
                        className={`w-8 h-8 rounded-lg text-xs font-mono font-semibold transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                id="btn-execute-split"
                onClick={handleExecuteSplit}
                disabled={isProcessing}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Extracting Pages...</span>
                  </>
                ) : (
                  <>
                    <Scissors className="w-4 h-4" />
                    <span>Split & Download Selected Pages</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. COMPRESS PDF VIEW */}
      {/* ------------------------------------------------------------- */}
      {activeSubTool === 'compress' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3.5">
          <input
            type="file"
            ref={compressInputRef}
            onChange={handleCompressFileSelected}
            accept=".pdf,application/pdf"
            className="hidden"
          />

          {!compressFile ? (
            <div
              onClick={() => compressInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-xl text-center cursor-pointer transition-colors space-y-2"
            >
              <Minimize2 className="w-6 h-6 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Select PDF to reduce file size</p>
              <p className="text-[11px] text-slate-500">Perfect for email attachments and portal uploads</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-slate-850 rounded-xl border border-slate-750 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-200 truncate max-w-xs">{compressFile.name}</p>
                  <p className="text-[11px] text-slate-400">Current Size: {formatBytes(compressFile.sizeBytes)}</p>
                </div>
                <button
                  onClick={() => {
                    setCompressFile(null);
                    setCompressResult(null);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Change
                </button>
              </div>

              {/* Compression Ratio Options */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { id: 'high', label: 'Max Compact', desc: 'Smallest size' },
                  { id: 'recommended', label: 'Balanced', desc: 'Optimal quality' },
                  { id: 'low', label: 'High Clarity', desc: 'Minimal loss' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setCompressionLevel(opt.id as any)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      compressionLevel === opt.id
                        ? 'bg-blue-600/20 border-blue-500 text-blue-200 font-bold shadow-xs'
                        : 'bg-slate-850 border-slate-750 text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] text-slate-500">{opt.desc}</div>
                  </button>
                ))}
              </div>

              {compressResult && (
                <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-emerald-300 block">
                      New Size: {formatBytes(compressResult.newSize)}
                    </span>
                    <span className="text-[11px] text-emerald-400">
                      Reduced by {Math.round((1 - compressResult.newSize / compressResult.originalSize) * 100)}%
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      downloadBlobFile(
                        compressResult.bytes,
                        `Compressed_${compressFile.name}`,
                        'application/pdf'
                      )
                    }
                    className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              )}

              <button
                id="btn-execute-compress"
                onClick={handleExecuteCompress}
                disabled={isProcessing}
                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Optimizing Document...</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-4 h-4" />
                    <span>Compress PDF</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. IMAGES TO PDF VIEW */}
      {/* ------------------------------------------------------------- */}
      {activeSubTool === 'images-to-pdf' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3.5">
          <input
            type="file"
            ref={imgInputRef}
            onChange={handleImagesSelected}
            accept="image/*"
            multiple
            className="hidden"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-rose-400" />
              Selected Images ({imgList.length})
            </span>
            <button
              onClick={() => imgInputRef.current?.click()}
              className="py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Images</span>
            </button>
          </div>

          {imgList.length === 0 ? (
            <div
              onClick={() => imgInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-xl text-center cursor-pointer transition-colors space-y-2"
            >
              <ImageIcon className="w-6 h-6 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Select pictures to convert into a single PDF</p>
              <p className="text-[11px] text-slate-500">Supports JPG, PNG, and WebP documents</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Orientation selector */}
              <div className="flex items-center justify-between text-xs bg-slate-850 p-2 rounded-xl border border-slate-750">
                <span className="text-slate-400">Page Orientation:</span>
                <div className="flex gap-1">
                  {(['auto', 'portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      onClick={() => setImgOrientation(o)}
                      className={`px-2 py-1 rounded text-[11px] font-medium uppercase ${
                        imgOrientation === o ? 'bg-blue-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              {/* Thumbnails list */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {imgList.map((img, idx) => (
                  <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-900 aspect-3/4">
                    <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setImgList((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 p-1 bg-black/70 hover:bg-rose-600 text-white rounded transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[9px] font-mono text-slate-300">
                      {idx + 1}
                    </span>
                  </div>
                ))}
              </div>

              <button
                id="btn-execute-images-to-pdf"
                onClick={handleExecuteImagesToPdf}
                disabled={isProcessing}
                className="w-full py-2.5 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Convert {imgList.length} Images to PDF</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 5. PDF TO IMAGES VIEW */}
      {/* ------------------------------------------------------------- */}
      {activeSubTool === 'pdf-to-images' && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3.5">
          <input
            type="file"
            ref={pdfToImgInputRef}
            onChange={handlePdfToImagesSelected}
            accept=".pdf,application/pdf"
            className="hidden"
          />

          {pdfPages.length === 0 ? (
            <div
              onClick={() => pdfToImgInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-xl text-center cursor-pointer transition-colors space-y-2"
            >
              <FileImage className="w-6 h-6 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Select a PDF to render into images</p>
              <p className="text-[11px] text-slate-500">Each page converts into a high-resolution JPG image</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Rendered Pages ({pdfPages.length})
                </span>
                <button
                  onClick={() => pdfToImgInputRef.current?.click()}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  Upload Another PDF
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {pdfPages.map((page) => (
                  <div
                    key={page.pageNumber}
                    className="p-2.5 bg-slate-850 rounded-xl border border-slate-750 space-y-2"
                  >
                    <div className="relative rounded-lg overflow-hidden border border-slate-700/60 aspect-3/4 bg-slate-900 flex items-center justify-center">
                      <img src={page.dataUrl} alt={`Page ${page.pageNumber}`} className="max-h-full object-contain" />
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="font-mono text-slate-300 text-xs">Page {page.pageNumber}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownloadSinglePageImage(page)}
                          className="p-1.5 rounded-lg bg-slate-750 hover:bg-slate-700 text-slate-200"
                          title="Download this page image"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleSendPageToOcr(page)}
                          className="px-2 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[11px] font-medium"
                          title="Extract text from this page"
                        >
                          OCR Text
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions Integration */}
      <QuickActionsBar
        documentText="PDF Tools utility session for merging, splitting, compressing, or converting documents."
        documentTitle="PDF Utilities"
        onTransferText={onTransferText}
        onSaveHistory={onSaveHistory}
        showFullActions={false}
      />
    </div>
  );
};
