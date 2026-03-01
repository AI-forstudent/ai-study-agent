import React, { useMemo } from 'react';
import { Document, Page } from 'react-pdf';
import { MessageSquare, Plus, Loader2, Sparkles, HelpCircle, BookOpen, Lightbulb } from 'lucide-react';
import type { Thread } from '../types';

interface PdfViewerProps {
  file: File;
  numPages: number;
  onDocumentLoadSuccess: ({ numPages }: { numPages: number }) => void;
  threads: Thread[];
  activeThread: Thread | null;
  setActiveThread: (thread: Thread | null) => void;
  textSelection: { text: string; x: number; y: number } | null;
  handleQuickAction: (action: 'translate' | 'explain' | 'quiz' | 'chat') => void;
  isCreatingThread: boolean;
  pdfContainerRef: React.RefObject<HTMLDivElement | null>;
  handleTextSelection: () => void;
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
  handleTextSelection
}) => {

  const analyzedIntent = useMemo(() => {
    if (!textSelection?.text) return 'general';
    const text = textSelection.text.trim();
    if (text.includes('?')) return 'question';
    if (text.split(' ').length <= 4) return 'concept'; 
    return 'general';
  }, [textSelection]);

  const handleSmartAction = (promptType: string) => {
    console.log("Smart Action Clicked:", promptType);
    handleQuickAction('chat'); 
  };

  return (
    <div 
      ref={pdfContainerRef} 
      className="flex-1 bg-slate-200 rounded-xl overflow-y-auto p-4 shadow-inner border border-slate-300 relative"
      onMouseUp={handleTextSelection}
    >
      <div className="relative inline-block min-w-full">
        <Document
          file={file} 
          className="flex flex-col items-center gap-6"
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(error) => console.error("שגיאה בטעינת PDF:", error)}
        >
          {Array.from(new Array(numPages), (_, index) => (
            <Page 
              key={`page_${index + 1}`} 
              pageNumber={index + 1} 
              className="shadow-xl bg-white mb-4"
              width={700}
              renderTextLayer={true} 
              renderAnnotationLayer={true}
            />
          ))}
        </Document>
        
        {threads.map((thread) => (
          <button
            key={thread.id}
            style={{
              position: 'absolute',
              left: thread.coordinates?.x || 0,
              top: thread.coordinates?.y || 0,
              transform: 'translate(-50%, -100%)', 
              zIndex: 40
            }}
            onClick={(e) => {
              e.stopPropagation(); 
              setActiveThread(thread);
            }}
            className={`transition-all duration-200 hover:scale-110 shadow-lg rounded-full p-2 border-2 ${
              activeThread?.id === thread.id 
                ? "bg-blue-600 border-white text-white z-50 scale-110" 
                : "bg-white border-blue-600 text-blue-600 hover:bg-blue-50"
            }`}
            title={thread.selected_text}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        ))}

        {/* תפריט פעולות דו-שכבתי מיושר ואחיד */}
        {textSelection && (
          <div
            style={{
              position: 'absolute', 
              left: textSelection.x,
              top: textSelection.y - 10,
              transform: 'translate(-50%, -100%)', 
              zIndex: 100 
            }}
            className="flex flex-col gap-1.5 animate-in fade-in zoom-in duration-200"
          >
            {/* שכבה עליונה: חכמה (Smart AI) - סגול */}
            <div className="bg-purple-600 text-white rounded-lg shadow-xl flex items-center overflow-hidden border border-purple-500 text-xs font-medium">
              <div className="bg-purple-700 px-2 py-2 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-purple-200" />
              </div>
              
              {analyzedIntent === 'question' && (
                <>
                  <button onClick={() => handleSmartAction('hint')} className="px-3 py-2 hover:bg-purple-500 transition-colors flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5"/> תן לי רמז
                  </button>
                  <div className="w-px h-4 bg-purple-400/50"></div>
                  <button onClick={() => handleSmartAction('step-by-step')} className="px-3 py-2 hover:bg-purple-500 transition-colors flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5"/> פתרון מודרך
                  </button>
                </>
              )}

              {analyzedIntent === 'concept' && (
                <>
                  <button onClick={() => handleSmartAction('define')} className="px-3 py-2 hover:bg-purple-500 transition-colors flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5"/> הגדר מושג
                  </button>
                  <div className="w-px h-4 bg-purple-400/50"></div>
                  <button onClick={() => handleSmartAction('example')} className="px-3 py-2 hover:bg-purple-500 transition-colors flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5"/> תן דוגמה
                  </button>
                </>
              )}

              {analyzedIntent === 'general' && (
                <button onClick={() => handleSmartAction('summarize')} className="px-3 py-2 hover:bg-purple-500 transition-colors flex items-center gap-1.5 w-full justify-center">
                  <Sparkles className="w-3.5 h-3.5"/> סכם פסקה זו
                </button>
              )}
            </div>

            {/* שכבה תחתונה: דיפולטיבית (Default Actions) - אפור כהה */}
            <div className="bg-slate-800 text-white rounded-lg shadow-xl flex items-center overflow-hidden border border-slate-700 text-xs font-medium">
              <button onClick={() => handleQuickAction('translate')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                <span className="text-sm leading-none">文</span> תרגם
              </button>
              <div className="w-px h-4 bg-slate-600"></div>
              
              <button onClick={() => handleQuickAction('explain')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                <span className="text-sm leading-none">💡</span> הסבר
              </button>
              <div className="w-px h-4 bg-slate-600"></div>
              
              <button onClick={() => handleQuickAction('quiz')} disabled={isCreatingThread} className="px-3 py-2 hover:bg-slate-700 transition-colors flex items-center gap-1.5">
                <span className="text-sm leading-none">❓</span> בחן אותי
              </button>
              
              {/* כפתור פתיחת שיחה מודגש */}
              <button onClick={() => handleQuickAction('chat')} disabled={isCreatingThread} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 transition-colors flex items-center gap-1.5 border-r border-blue-500">
                {isCreatingThread ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Plus className="w-3.5 h-3.5" />} צ'אט
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfViewer;