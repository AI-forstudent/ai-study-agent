import React from 'react';
import { Document, Page } from 'react-pdf';
import { MessageSquare, Plus, Loader2 } from 'lucide-react';
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
  return (
    <div 
      ref={pdfContainerRef} 
      className="flex-1 bg-slate-200 rounded-xl overflow-y-auto p-4 shadow-inner border border-slate-300 relative"
      onMouseUp={handleTextSelection}
    >
      <div className="relative inline-block min-w-full">
        <Document
          file={file} // הקסם: שימוש בקובץ המקומי. טוען את ה-PDF באפס זמן!
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
        
        {/* הצגת בועות של שיחות קיימות */}
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

        {/* תפריט פעולות מהירות */}
        {textSelection && (
          <div
            style={{
              position: 'absolute', 
              left: textSelection.x,
              top: textSelection.y,
              transform: 'translate(-50%, -100%)', 
              zIndex: 100 
            }}
            className="bg-slate-900 text-white rounded-lg shadow-2xl flex items-center overflow-hidden animate-in fade-in zoom-in duration-200 border border-slate-700 divide-x divide-slate-700 divide-x-reverse"
          >
            <button onClick={() => handleQuickAction('translate')} disabled={isCreatingThread} className="p-2 hover:bg-slate-700 flex flex-col items-center gap-1 min-w-[60px]">
              <span className="text-lg">文</span>
              <span className="text-[10px] font-bold">תרגם</span>
            </button>
            <button onClick={() => handleQuickAction('explain')} disabled={isCreatingThread} className="p-2 hover:bg-slate-700 flex flex-col items-center gap-1 min-w-[60px]">
              <span className="text-lg">💡</span>
              <span className="text-[10px] font-bold">הסבר</span>
            </button>
            <button onClick={() => handleQuickAction('quiz')} disabled={isCreatingThread} className="p-2 hover:bg-slate-700 flex flex-col items-center gap-1 min-w-[60px]">
              <span className="text-lg">❓</span>
              <span className="text-[10px] font-bold">בחן אותי</span>
            </button>
            <button onClick={() => handleQuickAction('chat')} disabled={isCreatingThread} className="p-3 bg-blue-600 hover:bg-blue-700">
              {isCreatingThread ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-5 h-5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfViewer;