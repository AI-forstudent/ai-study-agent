import React, { useMemo, useEffect } from 'react';
import { Document, Page } from 'react-pdf';
import { MessageSquare, Plus, Loader2, Sparkles, HelpCircle, BookOpen, Lightbulb } from 'lucide-react';
import type { Thread } from '../types';

interface PdfViewerProps {
  file: File | string;
  numPages: number;
  onDocumentLoadSuccess: ({ numPages }: { numPages: number }) => void;
  threads: Thread[];
  activeThread: Thread | null;
  setActiveThread: (thread: Thread | null) => void;
  textSelection: { text: string; x: number; y: number; width?: number; height?: number} | null;
  handleQuickAction: (action: 'translate' | 'explain' | 'quiz' | 'chat') => void;
  isCreatingThread: boolean;
  pdfContainerRef: React.RefObject<HTMLDivElement | null>;
  handleTextSelection: () => void;
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
}

const PdfViewer: React.FC<PdfViewerProps> = ({  
  file,
  numPages,
  onDocumentLoadSuccess,
  threads,
  activeThread,
  setActiveThread,
  textSelection,
  handleQuickAction,
  isCreatingThread,
  pdfContainerRef,
  handleTextSelection,
  currentPage,
  setCurrentPage,
  scale,
  setScale
}) => {

  const analyzedIntent = useMemo(() => {
    if (!textSelection?.text) return 'general';
    const text = textSelection.text.trim();
    if (text.includes('?')) return 'question';
    if (text.split(' ').length <= 4) return 'concept'; 
    return 'general';
  }, [textSelection]);

const handleSmartAction = (promptType: string) => {
  console.log("Smart action requested:", promptType); // הנה, עכשיו אנחנו "משתמשים" במשתנה!
  handleQuickAction('chat'); 
};

  // --- חיישן הגלילה (Intersection Observer) ---
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

  // --- מנגנון הזום (Ctrl + Wheel) ---
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); 
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale((prev) => Math.min(Math.max(prev + delta, 0.5), 3.0));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdfContainerRef, setScale]);

  return (
    <div 
      ref={pdfContainerRef} 
      className="flex-1 bg-slate-200 rounded-xl overflow-y-auto p-4 shadow-inner border border-slate-300 relative"
      onMouseUp={handleTextSelection}
    >
      <div className="sticky top-2 right-2 z-50 bg-white/90 backdrop-blur text-xs font-bold text-slate-600 px-3 py-1.5 rounded-full shadow-sm border border-slate-200 w-fit flex gap-2 items-center">
        <span>עמוד {currentPage} מתוך {numPages || '-'}</span>
        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{(scale * 100).toFixed(0)}%</span>
      </div>

      <div className="relative inline-block min-w-full mt-2">
        <Document
          file={file}
          className="flex flex-col items-center gap-6"
          onLoadSuccess={onDocumentLoadSuccess}
        >
          {Array.from(new Array(numPages), (_, index) => {
            const pageNum = index + 1;
            const pageThreads = threads.filter(t => t.page_number === pageNum);

            return (
              <div
                key={`page_wrapper_${pageNum}`}
                data-page-number={pageNum}
                className="pdf-page-wrapper shadow-xl bg-white mb-4 relative"
              >
                <Page
                  pageNumber={pageNum}
                  width={700}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />

                {/* --- רינדור מרקרים סגולים של שיחות קיימות בעמוד הזה --- */}
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
                        <div className="bg-slate-950 text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-2xl flex items-center gap-1.5 border border-slate-700">
                          <MessageSquare className="w-3 h-3 text-purple-400" />
                          <span className="font-medium">לחץ לפתיחת ההתכתבות</span>
                        </div>
                        {/* משולש תחתון תואם */}
                        <div className="w-2 h-2 bg-slate-950 border-r border-b border-slate-700 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
                      </div>
                    </div>
                  );
                })}

                {/* --- רינדור של טקסט שנבחר הרגע והסרגל שלו --- */}
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
                      <div className="bg-purple-600/85 backdrop-blur-md text-white rounded-lg shadow-xl flex items-center overflow-hidden border border-purple-400/50 text-xs font-medium min-w-max">
                        <div className="bg-purple-700/80 px-2 py-2 flex items-center justify-center">
                          <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                        </div>
                        
                        {analyzedIntent === 'question' && (
                          <>
                            <button onClick={() => handleSmartAction('hint')} className="px-3 py-2 hover:bg-purple-500/80 transition-colors flex items-center gap-1.5">
                              <Lightbulb className="w-3.5 h-3.5"/> תן לי רמז
                            </button>
                            <div className="w-px h-4 bg-purple-400/50"></div>
                            <button onClick={() => handleSmartAction('step-by-step')} className="px-3 py-2 hover:bg-purple-500/80 transition-colors flex items-center gap-1.5">
                              <HelpCircle className="w-3.5 h-3.5"/> פתרון מודרך
                            </button>
                          </>
                        )}

                        {analyzedIntent === 'concept' && (
                          <>
                            <button onClick={() => handleSmartAction('define')} className="px-3 py-2 hover:bg-purple-500/80 transition-colors flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5"/> הגדר מושג
                            </button>
                            <div className="w-px h-4 bg-purple-400/50"></div>
                            <button onClick={() => handleSmartAction('example')} className="px-3 py-2 hover:bg-purple-500/80 transition-colors flex items-center gap-1.5">
                              <Lightbulb className="w-3.5 h-3.5"/> תן דוגמה
                            </button>
                          </>
                        )}

                        {analyzedIntent === 'general' && (
                          <button onClick={() => handleSmartAction('summarize')} className="px-3 py-2 hover:bg-purple-500/80 transition-colors flex items-center gap-1.5 w-full justify-center">
                            <Sparkles className="w-3.5 h-3.5"/> סכם פסקה זו
                          </button>
                        )}
                      </div>

                      <div className="bg-slate-800/85 backdrop-blur-md text-white rounded-lg shadow-xl flex items-center overflow-hidden border border-slate-700/50 text-xs font-medium min-w-max">
                        <button onClick={() => handleQuickAction('translate')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5">
                          <span className="text-sm leading-none">文</span> תרגם
                        </button>
                        <div className="w-px h-4 bg-slate-600/80"></div>
                        
                        <button onClick={() => handleQuickAction('explain')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5">
                          <span className="text-sm leading-none">💡</span> הסבר
                        </button>
                        <div className="w-px h-4 bg-slate-600/80"></div>
                        
                        <button onClick={() => handleQuickAction('quiz')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5">
                          <span className="text-sm leading-none">❓</span> בחן אותי
                        </button>
                        
                        <button onClick={() => handleQuickAction('chat')} disabled={isCreatingThread} className="px-3 py-2 bg-blue-600/90 hover:bg-blue-500/90 transition-colors flex items-center gap-1.5 border-r border-blue-500/50">
                          {isCreatingThread ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Plus className="w-3.5 h-3.5" />} צ'אט
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
    </div>
  );
};

export default PdfViewer;