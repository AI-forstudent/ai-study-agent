import { useState, useEffect, useRef } from 'react'
import { FileText, Power } from 'lucide-react'
import { pdfjs } from 'react-pdf';

// קבצי עיצוב חובה כדי שה-PDF לא ייתקע וכדי שאפשר יהיה לסמן טקסט!
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
  const [threads, setThreads] = useState<Thread[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [systemStatus, setSystemStatus] = useState({ healthy: true, error: null as string | null });

  const { textSelection, activeThread, setTextSelection, setActiveThread } = useAppStore();
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const { handleShutdown } = useSystemControl(); 

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

  // הנה הפונקציה החסרה שמתריעה כשאתה מסמן טקסט!
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.toString().trim() === "") {
        setTextSelection(null); 
        return; 
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (pdfContainerRef.current) {
        const containerRect = pdfContainerRef.current.getBoundingClientRect();
        if (rect.left < containerRect.left) return;

        const x = rect.left - containerRect.left + (rect.width / 2);
        const y = rect.top - containerRect.top + pdfContainerRef.current.scrollTop - 10;

        setTextSelection({ text, x, y });
    }
  };

  // הנה פונקציית יצירת השיחה שחזרה למקומה
  const handleCreateThread = async (prompt?: string) => {
    if (!documentId || !textSelection) return;

    setIsCreatingThread(true);
    try {
      const payload = {
        document_id: documentId,
        selected_text: textSelection.text,
        page_number: 1, 
        coordinates: { x: textSelection.x, y: textSelection.y },
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
      console.error("Error creating thread:", error);
      alert("שגיאה ביצירת השיחה");
    } finally {
      setIsCreatingThread(false);
    }
  };

  // פונקציית הפעולות המהירות 
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

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !activeThread) return;
    const userMsgContent = inputMessage;
    setInputMessage("");
    setIsSending(true);

    try {
      const optimisticMsg: Message = { id: Date.now(), role: 'user', content: userMsgContent };
      const updatedThread = { ...activeThread, messages: [...(activeThread.messages || []), optimisticMsg] };
      setActiveThread(updatedThread);
      
      const response = await api.sendMessage(activeThread.id, userMsgContent + " (ענה בעברית, תשובה קצרה עד 7 שורות, השתמש בבולטים)");
      const finalThread = { ...updatedThread, messages: [...updatedThread.messages, response.data] };
      
      setActiveThread(finalThread);
      setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));
    } catch (error) {
      alert("לא הצלחתי לשלוח את ההודעה...");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans" dir="rtl">
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center">
          <div className="bg-blue-600 p-2 rounded-lg ml-3"><FileText className="text-white w-6 h-6" /></div>
          <h1 className="text-xl font-bold text-slate-800">AI Study Partner</h1>
        </div>
        <button onClick={handleShutdown} className="text-slate-400 hover:text-red-600 p-2 rounded-full transition-all">
          <Power className="w-6 h-6" />
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 h-[calc(100vh-80px)]">
        {!file && (
          <FileUploadView isUploading={isUploading} uploadError={uploadError} onFileChange={handleFileChange} />
        )}

        {file && (
          <div className="flex w-full h-full gap-6">
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
            />
            <ChatPanel 
              activeThread={activeThread} 
              threads={threads} 
              setActiveThread={setActiveThread}
              inputMessage={inputMessage} 
              setInputMessage={setInputMessage}
              handleSendMessage={handleSendMessage} 
              isSending={isSending}
            />
          </div>
        )}
      </main>
    </div>
  )
}

export default App;