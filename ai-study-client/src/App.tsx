import { useState, useEffect, useRef } from 'react'
import { FileText, Power, Settings} from 'lucide-react'
import { pdfjs } from 'react-pdf';

// קבצי עיצוב חובה
import 'katex/dist/katex.min.css'; 
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import FileUploadView from './components/FileUploadView';
import ChatPanel from './components/ChatPanel';
import PdfViewer from './components/PdfViewer';

import { api } from './services/api';
import { useSystemControl } from './hooks/useSystemControl';

import type { Message, Thread } from './types';
import { useAppStore } from './store/useAppStore';

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1); // הסטייט החדש למעקב עמוד!
  const [threads, setThreads] = useState<Thread[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [systemStatus, setSystemStatus] = useState({ healthy: true, error: null as string | null });
  const [pendingForkMsgId, setPendingForkMsgId] = useState<number | null>(null);
  const [treeViewMode, setTreeViewMode] = useState<'miller' | 'breadcrumbs' | 'graph'>('miller');
  const { textSelection, activeThread, setTextSelection, setActiveThread } = useAppStore();
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const { handleShutdown } = useSystemControl();
  const [chatWidth, setChatWidth] = useState(33); // מתחיל ב-33% מהמסך
  const [isDragging, setIsDragging] = useState(false); 
  const [scale, setScale] = useState(1.0);

  useEffect(() => {
    api.checkHealth()
      .then(() => setSystemStatus({ healthy: true, error: null }))
      .catch((err) => setSystemStatus({ 
        healthy: false, 
        error: err.response?.data?.detail || "אין תקשורת עם השרת" 
      }));
  }, []);

  useEffect(() => {
    if (documentId) {
      api.getThreads(documentId).then(res => setThreads(res.data));
    }
  }, [documentId]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const IS_DEV_MODE = false; 
    
    if (IS_DEV_MODE) {
      setFile(selectedFile); 
      setDocumentId(999); 
      setActiveThread(null);
      setThreads([]); 
      return; 
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      const response = await api.uploadDocument(selectedFile, 1); 
      setDocumentId(response.data.id);
      setFile(selectedFile);
      setActiveThread(null);
      setThreads([]);
    } catch (error) {
      setUploadError("הייתה בעיה בהעלאת הקובץ לשרת.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleTextSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.toString().trim() === "") {
          setTextSelection(null);
          return;
      }

      const text = selection.toString().trim();
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // קסם: אנחנו מחפשים למעלה בעץ ה-HTML את העמוד המדויק של ה-PDF!
      let node = range.commonAncestorContainer as Node | null;
      let pageElement: HTMLElement | null = null;
      while (node && node !== document.body) {
          if ((node as HTMLElement).classList && (node as HTMLElement).classList.contains('react-pdf__Page')) {
              pageElement = node as HTMLElement;
              break;
          }
          node = node.parentNode;
      }

      // אם איכשהו סימנו טקסט מחוץ ל-PDF (למשל בהדר), נבטל
      if (!pageElement) {
          setTextSelection(null);
          return;
      }

      // לוקחים את הקואורדינטות של העמוד הספציפי
      const pageRect = pageElement.getBoundingClientRect();

      // עכשיו מחשבים את המיקום ביחס לפינה של העמוד (ולא של המסך כולו!)
      const rawLeft = rect.left - pageRect.left;
      const rawTop = rect.top - pageRect.top;

      setTextSelection({
          text,
          x: rawLeft / scale,
          y: rawTop / scale,
          width: rect.width / scale,
          height: rect.height / scale
      });
  };

  const handleCreateThread = async (prompt?: string) => {
    if (!documentId || !textSelection) return;
    setIsCreatingThread(true);
    try {
      const payload = {
        document_id: documentId,
        selected_text: textSelection.text,
        page_number: currentPage,
        // התיקון: שומרים קואורדינטות "נקיות" ללא השפעת הזום הנוכחי
        coordinates: { 
          x: textSelection.x, 
          y: textSelection.y,
          width: (textSelection as any).width,   // <-- הוספנו
          height: (textSelection as any).height  // <-- הוספנו
        },
        initial_message: prompt
      };
      const response = await api.createThread(payload);
      const newThread = response.data;
      if (!newThread.messages) newThread.messages = [];
      setActiveThread(newThread);
      setThreads(prev => [...prev, newThread]);
      setTextSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      alert("שגיאה ביצירת השיחה");
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleQuickAction = async (action: 'translate' | 'explain' | 'quiz' | 'chat') => {
    if (action === 'chat') {
        handleCreateThread();
        return;
    }
    let prompt = "";
    switch (action) {
        case 'translate': prompt = "תרגם את הטקסט המסומן לעברית בצורה מדויקת וזורמת."; break;
        case 'explain': prompt = "הסבר את הטקסט המסומן במילים פשוטות (כמו לסטודנט מתחיל)."; break;
        case 'quiz': prompt = "צור שאלת הבנה אחת (אמריקאית) על הטקסט המסומן כדי לבחון אותי."; break;
    }
    handleCreateThread(prompt);
  };

  const handleForkMessage = (messageId: number) => {
    if (pendingForkMsgId === messageId) {
      setPendingForkMsgId(null); 
    } else {
      setPendingForkMsgId(messageId); 
    }
  };

const handleSendMessage = async () => {
    if (!inputMessage.trim() || !activeThread) return;
    const userMsgContent = inputMessage;
    setInputMessage("");
    setIsSending(true);

    // === התיקון שלנו: זיהוי חכם של תחילת שיחה או פיצול חדש ===
    const isFirstMessageInThisThread = pendingForkMsgId !== null || (!activeThread.messages || activeThread.messages.length === 0);

    try {
      let targetThread = activeThread;
      if (pendingForkMsgId) {
        const forkResponse = await api.forkThread(activeThread.id, pendingForkMsgId);
        targetThread = forkResponse.data;
        setThreads(prev => [...prev, targetThread]);
        setPendingForkMsgId(null); 
      }

      const optimisticMsg: Message = { id: Date.now(), role: 'user', content: userMsgContent };
      const updatedThread = { ...targetThread, messages: [...(targetThread.messages || []), optimisticMsg] };
      setActiveThread(updatedThread);
      
      const response = await api.sendMessage(targetThread.id, userMsgContent);
      
      try {
        const freshThreadRes = await api.getThread(targetThread.id);
        const finalThread = freshThreadRes.data;
        setActiveThread(finalThread);
        setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));

        // === התיקון: משתמשים במשתנה החכם שיצרנו במקום לספור הודעות! ===
        if (isFirstMessageInThisThread) {
          setTimeout(async () => {
            try {
              const lateThreadRes = await api.getThread(targetThread.id);
              const updatedLateThread = lateThreadRes.data;
              
              setThreads(prev => prev.map(t => t.id === updatedLateThread.id ? updatedLateThread : t));
              
              const currentActive = useAppStore.getState().activeThread;
              if (currentActive?.id === updatedLateThread.id) {
                setActiveThread(updatedLateThread);
              }
            } catch (err) {
              console.error("Failed to fetch late title", err);
            }
          }, 4500); 
        }
        // ==========================================================

      } catch (refreshError) {
        const finalThread = { ...updatedThread, messages: [...updatedThread.messages, response.data] };
        setActiveThread(finalThread);
        setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));
      }
      
    } catch (error) {
      alert("לא הצלחתי לשלוח את ההודעה...");
    } finally {
      setIsSending(false);
    }
  };

const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    
    // בגלל שאנחנו ב-RTL (הצ'אט משמאל), מיקום העכבר ביחס לרוחב המסך 
    // נותן לנו בדיוק את האחוז שהצ'אט צריך לתפוס!
    const newWidthPercent = (e.clientX / window.innerWidth) * 100;

    // מגבילים את ההקטנה/הגדלה כדי שהמשתמש לא "יעלים" את המסך בטעות
    if (newWidthPercent > 20 && newWidthPercent < 60) {
      setChatWidth(newWidthPercent);
    }
  };

  const handleMouseUp = () => {
    if (isDragging) setIsDragging(false);
  };
  
return (
    // 1. נועלים את העמוד כולו לגובה ורוחב המסך בדיוק, ומונעים גלילה כללית!
    <div className="h-screen w-screen overflow-hidden bg-slate-50 flex flex-col font-sans" dir="rtl">
      
      {/* 2. נועלים את ההדר למעלה שלא יתכווץ (shrink-0) */}
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm shrink-0 z-10">
        <div className="flex items-center">
          <div className="bg-blue-600 p-2 rounded-lg ml-3"><FileText className="text-white w-6 h-6" /></div>
          <h1 className="text-xl font-bold text-slate-800">AI Study Partner</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <Settings className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-600">תצוגת עץ:</span>
            <select 
              value={treeViewMode}
              onChange={(e) => setTreeViewMode(e.target.value as 'miller' | 'breadcrumbs' | 'graph')}
              className="bg-transparent text-sm font-bold text-blue-600 focus:outline-none cursor-pointer pr-1"
            >
              <option value="miller">עמודות מילר (מומלץ)</option>
              <option value="graph">תרשים זרימה גרפי</option>
              <option value="breadcrumbs">פירורי לחם (glich)</option>
            </select>
          </div>
          <button onClick={handleShutdown} className="text-slate-400 hover:text-red-600 p-2 rounded-full transition-all">
            <Power className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* 3. אזור התוכן המרכזי מקבל overflow-hidden כדי לא להישפך החוצה */}
      <main className="flex-1 flex overflow-hidden p-6 relative">
        
        {/* במצב שלפני העלאת קובץ (מרכזים את אלמנט ההעלאה) */}
        {!file && (
          <div className="w-full h-full flex items-center justify-center">
             <FileUploadView isUploading={isUploading} uploadError={uploadError} onFileChange={handleFileChange} />
          </div>
        )}

        {/* במצב שבו קובץ טעון - כאן הקסם קורה */}
{file && (
          <div 
            className="flex w-full h-full overflow-hidden relative"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp} // עוצר את הגרירה אם העכבר יצא מהמסך
          >
            {/* שכבת מגן שקופה: מונעת מה-PDF לבלוע את אירועי העכבר בזמן הגרירה */}
            {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}

            {/* אזור ה-PDF תופס את שאר המקום שנותר (flex-1) */}
            <div className="flex-1 h-full flex flex-col overflow-hidden ml-1">
              <PdfViewer 
                file={file} 
                numPages={numPages}
                onDocumentLoadSuccess={({numPages}) => setNumPages(numPages)}
                threads={threads} 
                activeThread={activeThread} 
                setActiveThread={setActiveThread}
                textSelection={textSelection} 
                handleQuickAction={handleQuickAction} 
                isCreatingThread={isCreatingThread} 
                pdfContainerRef={pdfContainerRef}
                handleTextSelection={handleTextSelection} 
                currentPage={currentPage}          
                setCurrentPage={setCurrentPage}    
                scale={scale}      // <-- נוסף
                setScale={setScale} // <-- נוסף
              />
            </div>

            {/* המפריד הנגרר (Divider) - כאן הקסם קורה! */}
            <div
              className={`w-2 cursor-col-resize hover:bg-blue-400 transition-colors z-20 flex-shrink-0 mx-3 rounded-full ${isDragging ? 'bg-blue-500' : 'bg-slate-200'}`}
              onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
              title="גרור כדי לשנות גודל"
            />

            {/* אזור הצ'אט שמקבל את הרוחב הדינמי שלנו מהסטייט */}
            <div style={{ width: `${chatWidth}%` }} className="flex-shrink-0 overflow-hidden">
              <ChatPanel
                activeThread={activeThread}
                threads={threads}
                setActiveThread={setActiveThread}
                inputMessage={inputMessage}
                setInputMessage={setInputMessage}
                handleSendMessage={handleSendMessage}
                isSending={isSending}
                onForkMessage={handleForkMessage} 
                pendingForkMsgId={pendingForkMsgId}
                treeViewMode={treeViewMode}
                currentPage={currentPage}          
              />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App;