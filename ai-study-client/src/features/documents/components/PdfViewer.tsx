import React, { useState, useMemo, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { MessageSquare, Plus, Loader2, Sparkles, HelpCircle, BookOpen, Lightbulb } from 'lucide-react';
import type { Thread } from '../../../types';
import DocumentLoader, { DocumentError } from './DocumentLoader';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  file: File | string;
  numPages: number;
  onDocumentLoadSuccess: ({ numPages }: { numPages: number }) => void;
  threads: Thread[];
  activeThread: Thread | null;
  setActiveThread: (thread: Thread | null) => void;
  textSelection: { text: string; x: number; y: number; width?: number; height?: number} | null;
  handleQuickAction: (action: 'translate' | 'explain' | 'quiz' | 'chat') => void;
  handleSmartAction: (action: string) => void;
  isCreatingThread: boolean;
  pdfContainerRef: React.RefObject<HTMLDivElement | null>;
  handleTextSelection: () => void;
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS  = 60_000;

const PdfViewer: React.FC<PdfViewerProps> = ({
  file,
  numPages,
  onDocumentLoadSuccess,
  threads,
  activeThread,
  setActiveThread,
  textSelection,
  handleQuickAction,
  handleSmartAction,
  isCreatingThread,
  pdfContainerRef,
  handleTextSelection,
  currentPage,
  setCurrentPage,
  scale,
  setScale
}) => {

  // ── Polling state — for Office-to-PDF conversion lag ─────────────────────
  const [retryKey,     setRetryKey]     = useState(0);
  const [isPolling,    setIsPolling]    = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  // Reset polling whenever the source file changes
  useEffect(() => {
    setIsPolling(false);
    setPollTimedOut(false);
    setRetryKey(0);
  }, [file]);

  // Poll the URL until the backend has finished writing the PDF (or 60 s passes)
  useEffect(() => {
    if (!isPolling || typeof file !== 'string') return;

    let stopped = false;

    const interval = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(file, { method: 'HEAD' });
        if (res.ok && !stopped) {
          stopped = true;
          clearInterval(interval);
          clearTimeout(timeoutId);
          setIsPolling(false);
          setRetryKey(k => k + 1);
        }
      } catch {
        // not ready yet — keep polling
      }
    }, POLL_INTERVAL_MS);

    const timeoutId = setTimeout(() => {
      if (!stopped) {
        stopped = true;
        clearInterval(interval);
        setIsPolling(false);
        setPollTimedOut(true);
      }
    }, POLL_TIMEOUT_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(timeoutId);
    };
  }, [isPolling, file]);

  // ── Fired by react-pdf when the Document fails to parse/load ─────────────
  // Polling is only useful for HTTP URLs (covers the Office-to-PDF conversion
  // lag — file path exists in DB but Nginx hasn't seen the new file yet).
  // Blob URLs are local in-memory references; if they fail to parse the data
  // is already in hand, so retrying won't change anything — show the error.
  const handleLoadError = (err: Error) => {
    console.warn('[PdfViewer] Load error:', err.message);
    const isHttpUrl = typeof file === 'string' && !file.startsWith('blob:');
    if (isHttpUrl && !pollTimedOut) {
      setIsPolling(true);
    } else {
      setPollTimedOut(true);
    }
  };

  // ── IntersectionObserver — track visible page number ─────────────────────
  const analyzedIntent = useMemo(() => {
    if (!textSelection?.text) return 'general';
    const text = textSelection.text.trim();
    if (text.includes('?')) return 'question';
    if (text.split(' ').length <= 4) return 'concept';
    return 'general';
  }, [textSelection]);

  const [isZooming, setIsZooming] = useState(false);

  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = Number(entry.target.getAttribute('data-page-number'));
            if (pageNum) {
              setCurrentPage(prevPage => prevPage !== pageNum ? pageNum : prevPage);
            }
          }
        });
      },
      {
        root: container,
        rootMargin: "-50% 0px -50% 0px",
        threshold: 0
      }
    );

    const timer = setTimeout(() => {
      const pageElements = container.querySelectorAll('.pdf-page-wrapper');
      pageElements.forEach((el) => observer.observe(el));
    }, 1000);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [numPages, setCurrentPage, pdfContainerRef]);

  // ── Ctrl/Cmd + wheel zoom ─────────────────────────────────────────────────
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setIsZooming(true);
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale((prev) => Math.min(Math.max(prev + delta, 0.8), 3.0));
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setIsZooming(false);
        }, 500);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      clearTimeout(timeoutId);
    };
  }, [pdfContainerRef, setScale]);

  const pdfOptions = useMemo(() => ({
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
  }), []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={pdfContainerRef}
      className="flex-1 bg-[#EFEFED] rounded-xl overflow-auto p-4 border border-[#E8E8E6] relative"
      onMouseUp={handleTextSelection}
    >
      {/* ── Polling overlay: backend conversion in progress ───────────────── */}
      {isPolling && (
        <DocumentLoader message="Converting your document — this can take up to 60 seconds…" />
      )}

      {/* ── Permanent error: conversion timed out ────────────────────────── */}
      {!isPolling && pollTimedOut && (
        <DocumentError />
      )}

      {/* ── Normal PDF viewer ─────────────────────────────────────────────── */}
      {!isPolling && !pollTimedOut && (
        <>
          <div className="sticky top-2 end-2 z-50 bg-white/90 backdrop-blur text-xs font-medium text-[#787774] px-3 py-1.5 rounded-full border border-[#E8E8E6] w-fit flex gap-2 items-center">
            <span>Page {currentPage} of {numPages || '—'}</span>
            <button
              onClick={() => setScale(1.0)}
              title="Click to reset zoom"
              className="bg-[#EFEFED] hover:bg-[#E8E8E6] text-[#787774] px-2 py-0.5 rounded cursor-pointer transition-colors duration-150 font-medium"
            >
              {(scale * 100).toFixed(0)}%
            </button>
          </div>

          <div className="relative flex flex-col items-center mt-2 w-max mx-auto">
            <Document
              key={retryKey}
              // Cache-busting `?retry=N` is only valid on http(s) URLs. Blob
              // URLs are not registered with query strings appended, so adding
              // one breaks them — and they don't need cache-busting anyway
              // since the data is already in memory.
              file={
                typeof file === 'string'
                  ? (file.startsWith('blob:') ? file : `${file}?retry=${retryKey}`)
                  : file
              }
              className="flex flex-col items-center gap-6"
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={handleLoadError}
              options={pdfOptions}
              loading={<DocumentLoader />}
              error={isPolling ? <DocumentLoader message="Converting your document…" /> : <DocumentError />}
              noData={<DocumentLoader />}
            >
              {Array.from(new Array(numPages), (_, index) => {
                const pageNum = index + 1;
                const pageThreads = threads.filter(t => t.page_number === pageNum);

                return (
                  <div
                    key={`page_wrapper_${pageNum}`}
                    data-page-number={pageNum}
                    className="pdf-page-wrapper shadow-sm bg-white mb-4 relative transition-all duration-100 ease-out border border-[#E8E8E6]">
                    <Page
                      pageNumber={pageNum}
                      width={700}
                      scale={scale}
                      renderTextLayer={!isZooming}
                      renderAnnotationLayer={!isZooming}
                      loading={null}
                    />

                    {pageThreads.map((thread) => {
                      const left = thread.coordinates?.x || 0;
                      const top = thread.coordinates?.y || 0;
                      const width = thread.coordinates?.width || 40;
                      const height = thread.coordinates?.height || 16;

                      return (
                        <div
                          key={thread.id}
                          style={{
                            position: 'absolute',
                            left: left * scale,
                            top: top * scale,
                            width: width * scale,
                            height: height * scale,
                            zIndex: 40,
                            backgroundColor: activeThread?.id === thread.id ? 'rgba(147, 51, 234, 0.4)' : 'rgba(168, 85, 247, 0.25)',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            borderBottom: activeThread?.id === thread.id ? '2px solid rgb(147, 51, 234)' : 'none'
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveThread(thread);
                          }}
                          className="group transition-colors hover:bg-purple-500/40 mix-blend-multiply"
                        >
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                            <div className="bg-slate-950 text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-lg flex items-center gap-1.5 border border-slate-700">
                              <MessageSquare className="w-3 h-3 text-indigo-400" />
                              <span className="font-medium">Open conversation</span>
                            </div>
                            <div className="w-2 h-2 bg-slate-950 border-r border-b border-slate-700 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
                          </div>
                        </div>
                      );
                    })}

                    {textSelection && currentPage === pageNum && (
                      <>
                        <div
                          style={{
                            position: 'absolute',
                            left: textSelection.x * scale,
                            top: textSelection.y * scale,
                            width: (textSelection.width || 0) * scale,
                            height: (textSelection.height || 0) * scale,
                            backgroundColor: 'rgba(147, 51, 234, 0.3)',
                            zIndex: 30,
                            mixBlendMode: 'multiply'
                          }}
                        />

                        <div
                          style={{
                            position: 'absolute',
                            left: (textSelection.x + ((textSelection.width || 0) / 2)) * scale,
                            top: (textSelection.y * scale) - 15,
                            transform: 'translate(-50%, -100%)',
                            zIndex: 100
                          }}
                          className="flex flex-col gap-1.5 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 drop-shadow-2xl"
                        >
                          <div className="bg-indigo-700/90 backdrop-blur-md text-white rounded-lg shadow-lg flex items-center overflow-hidden border border-indigo-500/50 text-xs font-medium min-w-max">
                            <div className="bg-indigo-800/80 px-2 py-2 flex items-center justify-center">
                              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                            </div>

                            {analyzedIntent === 'question' && (
                              <>
                                <button onClick={() => handleSmartAction('hint')} className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5">
                                  <Lightbulb className="w-3.5 h-3.5" /> Give a hint
                                </button>
                                <div className="w-px h-4 bg-indigo-500/50" />
                                <button onClick={() => handleSmartAction('step-by-step')} className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5">
                                  <HelpCircle className="w-3.5 h-3.5" /> Step-by-step
                                </button>
                              </>
                            )}

                            {analyzedIntent === 'concept' && (
                              <>
                                <button onClick={() => handleSmartAction('define')} className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5">
                                  <BookOpen className="w-3.5 h-3.5" /> Define
                                </button>
                                <div className="w-px h-4 bg-indigo-500/50" />
                                <button onClick={() => handleSmartAction('example')} className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5">
                                  <Lightbulb className="w-3.5 h-3.5" /> Give example
                                </button>
                              </>
                            )}

                            {analyzedIntent === 'general' && (
                              <button onClick={() => handleSmartAction('summarize')} className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5 w-full justify-center">
                                <Sparkles className="w-3.5 h-3.5" /> Summarize
                              </button>
                            )}
                          </div>

                          <div className="bg-slate-800/90 backdrop-blur-md text-white rounded-lg shadow-lg flex items-center overflow-hidden border border-slate-700/50 text-xs font-medium min-w-max">
                            <button onClick={() => handleQuickAction('translate')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5">
                              <span className="text-sm leading-none">文</span> Translate
                            </button>
                            <div className="w-px h-4 bg-slate-600/80" />
                            <button onClick={() => handleQuickAction('explain')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5">
                              <span className="text-sm leading-none">💡</span> Explain
                            </button>
                            <div className="w-px h-4 bg-slate-600/80" />
                            <button onClick={() => handleQuickAction('quiz')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5">
                              <span className="text-sm leading-none">❓</span> Quiz me
                            </button>
                            <button onClick={() => handleQuickAction('chat')} disabled={isCreatingThread} className="px-3 py-2 bg-indigo-600/90 hover:bg-indigo-500/90 transition-colors flex items-center gap-1.5 border-s border-indigo-500/50">
                              {isCreatingThread ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Chat
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </Document>
          </div>
        </>
      )}
    </div>
  );
};

export default PdfViewer;
