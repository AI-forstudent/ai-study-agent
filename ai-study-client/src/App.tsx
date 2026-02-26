import { useState, useEffect, useRef } from 'react'
import { Upload, FileText, Loader2, AlertCircle, Send, Bot, User as UserIcon, X, MessageSquare, Plus, Power } from 'lucide-react'
import axios from 'axios'
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css'; 
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type {Message, Thread } from './types';
import { useAppStore } from './store/useAppStore';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function App() {
  // --- States ---
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  
  const [threads, setThreads] = useState<Thread[]>([]);
  
  const [inputMessage, setInputMessage] = useState(""); 
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isSystemHealthy, setIsSystemHealthy] = useState<boolean>(true); // מתחילים אופטימיים
  const [systemErrorMessage, setSystemErrorMessage] = useState<string | null>(null);
  const { textSelection, activeThread, setTextSelection, setActiveThread } = useAppStore();
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const API_URL = "http://localhost:8000";

  // בדיקת דופק בעליית האתר
  useEffect(() => {
    const checkSystemHealth = async () => {
      try {
        await axios.get(`${API_URL}/health`);
        setIsSystemHealthy(true);
        setSystemErrorMessage(null);
      } catch (error: any) {
        console.error("System health check failed:", error);
        setIsSystemHealthy(false);
        // ננסה לחלץ את הודעת השגיאה מהשרת, או נציג הודעה כללית
        const msg = error.response?.data?.detail || "אין תקשורת עם השרת או שמפתח ה-API שגוי.";
        setSystemErrorMessage(msg);
      }
    };
    
    checkSystemHealth();
  }, []);
  // --- Effects ---

  useEffect(() => {
    if (documentId) {
      fetchThreads();
    }
  }, [documentId]);

  const fetchThreads = async () => {
    if (!documentId) return;
    try {
      const response = await axios.get(`${API_URL}/documents/${documentId}/threads/`);
      setThreads(response.data);
    } catch (error) {
      console.error("Error fetching threads:", error);
    }
  };

  // --- Logic ---

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const userId = 1; 

      const response = await axios.post(
        `${API_URL}/documents/?user_id=${userId}`, 
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setDocumentId(response.data.id);
      setFile(selectedFile); 
      setActiveThread(null); 
      setThreads([]); 

    } catch (error) {
      console.error("❌ Upload failed:", error);
      setUploadError("הייתה בעיה בהעלאת הקובץ לשרת.");
      setFile(null);
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

    if (pdfContainerRef.current) {
        const containerRect = pdfContainerRef.current.getBoundingClientRect();
        if (rect.left < containerRect.left) return;

        const x = rect.left - containerRect.left + (rect.width / 2);
        const y = rect.top - containerRect.top + pdfContainerRef.current.scrollTop - 10;

        setTextSelection({ text, x, y });
    }
  };

  const handleCreateThread = async () => {
    if (!documentId || !textSelection) return;

    setIsCreatingThread(true);
    try {
      const payload = {
        document_id: documentId,
        selected_text: textSelection.text,
        page_number: 1, 
        coordinates: { x: textSelection.x, y: textSelection.y } 
      };

      const response = await axios.post(`${API_URL}/threads/`, payload);
      
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

  // פונקציה שמטפלת בפעולות מהירות (Predictive UI)
// פונקציה שמטפלת בפעולות מהירות (Predictive UI)
  const handleQuickAction = async (action: 'translate' | 'explain' | 'quiz' | 'chat') => {
    if (!documentId || !textSelection) return;

    // 1. אם המשתמש בחר "שיחה", נפתח סתם בועה ריקה (כמו קודם)
    if (action === 'chat') {
        handleCreateThread();
        return;
    }

    // 2. הכנת הפרומפט הסמוי
    let prompt = "";
    switch (action) {
        case 'translate': 
            prompt = "תרגם את הטקסט המסומן לעברית בצורה מדויקת וזורמת."; 
            break;
        case 'explain': 
            prompt = "הסבר את הטקסט המסומן במילים פשוטות (כמו לסטודנט מתחיל)."; 
            break;
        case 'quiz': 
            prompt = "צור שאלת הבנה אחת (אמריקאית) על הטקסט המסומן כדי לבחון אותי."; 
            break;
    }

    setIsCreatingThread(true);
    try {
      // שימוש ב-Endpoint הקיים, אבל עם initial_message
      const payload = {
        document_id: documentId,
        selected_text: textSelection.text,
        page_number: 1, // בהמשך נסדר שזה יהיה דינמי
        coordinates: { x: textSelection.x, y: textSelection.y },
        initial_message: prompt // <--- הקסם קורה כאן
      };

      const response = await axios.post(`${API_URL}/threads/`, payload);
      const newThread = response.data;
      
      setActiveThread(newThread);
      setThreads(prev => [...prev, newThread]);
      
      // ניקוי בחירה
      setTextSelection(null);
      window.getSelection()?.removeAllRanges();

    } catch (error) {
      console.error("Error creating quick thread:", error);
      alert("שגיאה ביצירת הפעולה המהירה");
    } finally {
      setIsCreatingThread(false);
    }
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
      setThreads(prev => prev.map(t => t.id === updatedThread.id ? updatedThread : t));

      const response = await axios.post(`${API_URL}/threads/${activeThread.id}/messages/`, {
        content: userMsgContent + " (ענה בעברית, תשובה קצרה עד 7 שורות, השתמש בבולטים)"
      });

      const aiMsg = response.data; 
      
      const finalThread = {
          ...updatedThread,
          messages: [...updatedThread.messages, aiMsg]
      };

      setActiveThread(finalThread);
      setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));

    } catch (error) {
      console.error("Failed to send message:", error);
      alert("לא הצלחתי לשלוח את ההודעה...");
    } finally {
      setIsSending(false);
    }
  };

  // --- לוגיקה של כיבוי מערכת ---
// --- לוגיקה של כיבוי מערכת (גרסה שקטה ומיידית) ---
  const handleShutdown = async () => {
    // 1. מיד משנים את המסך לשחור כדי לתת תחושה של כיבוי מיידי
    document.body.innerHTML = `
      <div style='display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;background:#111;color:#666;font-family:sans-serif;text-align:center'>
        <h1 style='font-size:24px;margin-bottom:10px'>המערכת כבתה</h1>
        <p>ניתן לסגור את הטאב</p>
      </div>
    `;

    try {
      // 2. שולחים את פקודת ההשמדה לשרת
      // אנחנו לא מחכים לתשובה (await) כדי לא להתעכב, אלא משגרים ושוכחים
      axios.post(`${API_URL}/system/shutdown`).catch(() => {
        // התעלמות מכוונת משגיאות.
        // אם השרת מת מיד - זה מצוין, אנחנו לא רוצים להציג שגיאה למשתמש.
      });
      
      // 3. ניסיון לסגור את הטאב
      window.close();
      
    } catch (error) {
      // לא עושים כלום, לא מציגים alert
    }
  };

  // האזנה לקיצור מקלדת Ctrl + Q
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // אם לחצו Ctrl + Q (או Meta + Q במק)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'q' || e.key === 'Q' || e.key === '/')) {
        e.preventDefault(); // מניעת התנהגות דיפולטיבית
        handleShutdown();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- UI ---
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans" dir="rtl">
      
      <header className="bg-white border-b border-slate-200 p-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
          <div className="flex items-center">
            <div className="bg-blue-600 p-2 rounded-lg ml-3 shadow-md shadow-blue-200">
              <FileText className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">AI Study Partner</h1>
        </div>
        
        {/* כפתור הכיבוי החדש */}
        <button 
            onClick={handleShutdown}
            className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-full transition-all"
            title="כיבוי המערכת (Ctrl + Q)"
        >
            <Power className="w-6 h-6" />
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 h-[calc(100vh-80px)]">

        {/* --- תוספת: באנר שגיאת מערכת --- */}
{/* --- באנר שגיאת מערכת משודרג --- */}
        {!isSystemHealthy && (
            <div className="fixed inset-0 bg-slate-900/95 z-50 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-300">
                <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md text-center border-t-4 border-red-500 relative">
                    
                    {/* אייקון שגיאה */}
                    <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="w-8 h-8" />
                    </div>

                    <h2 className="text-2xl font-bold text-slate-800 mb-2">תקלת מערכת</h2>
                    <p className="text-slate-600 mb-6">{systemErrorMessage || "אין תקשורת עם השרת"}</p>
                    
                    <div className="bg-slate-50 p-3 rounded text-right text-xs text-slate-500 font-mono mb-6 border border-slate-200">
                         System Check Failed. <br/>
                         Please verify backend connectivity.
                    </div>

                    {/* כפתורי פעולה */}
                    <div className="flex gap-3 justify-center">
                        {/* כפתור נסה שוב */}
                        <button 
                            onClick={() => window.location.reload()} 
                            className="bg-slate-800 text-white px-6 py-2 rounded-full hover:bg-slate-700 transition-all font-medium"
                        >
                            נסה שוב
                        </button>

                        {/* כפתור כיבוי חירום - התוספת החדשה */}
                        <button 
                            onClick={handleShutdown}
                            className="flex items-center gap-2 bg-red-50 text-red-600 border border-red-200 px-6 py-2 rounded-full hover:bg-red-600 hover:text-white transition-all font-medium"
                        >
                            <Power className="w-4 h-4" />
                            סגור מערכת
                        </button>
                    </div>

                </div>
            </div>
        )}
        
        {!file && (
          <div className="bg-white p-12 rounded-3xl shadow-xl border border-slate-100 text-center max-w-lg w-full">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 transition-colors ${
              uploadError ? 'bg-red-50' : 'bg-blue-50'
            }`}>
              {isUploading ? (
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              ) : uploadError ? (
                <AlertCircle className="w-12 h-12 text-red-500" />
              ) : (
                <Upload className="w-10 h-10 text-blue-600" />
              )}
            </div>
            <h2 className="text-3xl font-bold text-slate-800 mb-3">
              {isUploading ? "מעבד את המסמך..." : "העלה סיכום או מאמר"}
            </h2>
             {!isUploading && (
              <label className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 px-10 rounded-2xl cursor-pointer shadow-lg inline-flex items-center gap-2">
                <Upload className="w-5 h-5" />
                <span>בחר קובץ PDF</span>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
              </label>
            )}
          </div>
        )}

        {file && (
          <div className="flex w-full h-full gap-6">
            
            {/* צד ימין: PDF */}
            <div 
              ref={pdfContainerRef} 
              className="flex-1 bg-slate-200 rounded-xl overflow-y-auto p-4 shadow-inner border border-slate-300 relative"
              onMouseUp={handleTextSelection}
            >
              <div className="relative inline-block min-w-full">
                  <Document
                    file={`${API_URL}/uploads/${encodeURIComponent(file.name)}`}
                    className="flex flex-col items-center gap-6"
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(e) => console.error("Error loading PDF:", e)}
                  >
                    {Array.from(new Array(numPages), (el, index) => (
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
                            left: thread.coordinates.x,
                            top: thread.coordinates.y,
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
                        {/* כפתור תרגום */}
                        <button 
                            onClick={() => handleQuickAction('translate')}
                            className="p-2 hover:bg-slate-700 transition-colors flex flex-col items-center gap-1 min-w-[60px]"
                            disabled={isCreatingThread}
                        >
                            <span className="text-lg">文</span>
                            <span className="text-[10px] font-bold">תרגם</span>
                        </button>

                        {/* כפתור הסבר */}
                        <button 
                            onClick={() => handleQuickAction('explain')}
                            className="p-2 hover:bg-slate-700 transition-colors flex flex-col items-center gap-1 min-w-[60px]"
                            disabled={isCreatingThread}
                        >
                            <span className="text-lg">💡</span>
                            <span className="text-[10px] font-bold">הסבר</span>
                        </button>

                        {/* כפתור בוחן */}
                        <button 
                            onClick={() => handleQuickAction('quiz')}
                            className="p-2 hover:bg-slate-700 transition-colors flex flex-col items-center gap-1 min-w-[60px]"
                            disabled={isCreatingThread}
                        >
                            <span className="text-lg">❓</span>
                            <span className="text-[10px] font-bold">בחן אותי</span>
                        </button>

                        {/* כפתור שיחה רגילה (פלוס) */}
                        <button 
                            onClick={() => handleQuickAction('chat')}
                            className="p-3 bg-blue-600 hover:bg-blue-700 transition-colors flex items-center justify-center"
                            disabled={isCreatingThread}
                        >
                            {isCreatingThread ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-5 h-5" />}
                        </button>
                    </div>
                  )}
              </div>
            </div>

            {/* צד שמאל: צ'אט */}
            <div className="w-1/3 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden h-full max-h-full transition-all">
              
              <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
                <h2 className="font-bold text-slate-700 flex items-center gap-2">
                  <Bot className="w-5 h-5 text-blue-600"/> 
                  {activeThread ? "השיחה שלי" : "העוזר האישי"}
                </h2>
                {activeThread && (
                  <button 
                    onClick={() => setActiveThread(null)} 
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                    title="סגור שיחה"
                  >
                    <X className="w-5 h-5"/>
                  </button>
                )}
              </div>

              {!activeThread ? (
                <div className="flex-1 flex flex-col p-6 overflow-y-auto">
                    {threads.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center space-y-4">
                            <div className="bg-slate-50 p-6 rounded-full">
                                <MessageSquare className="w-10 h-10 opacity-50"/>
                            </div>
                            <p className="text-lg">סמן טקסט ב-PDF כדי להתחיל</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-slate-500 text-sm font-medium mb-2">שיחות קודמות:</p>
                            {threads.map(t => (
                                <div 
                                    key={t.id}
                                    onClick={() => setActiveThread(t)}
                                    className="p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 hover:shadow-md cursor-pointer transition-all group"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="bg-blue-100 p-1 rounded">
                                            <MessageSquare className="w-3 h-3 text-blue-600"/>
                                        </div>
                                        <span className="text-xs text-slate-400">עמוד {t.coordinates?.y ? "מזוהה" : "1"}</span>
                                    </div>
                                    <p className="text-slate-700 text-sm line-clamp-2 font-medium">"{t.selected_text}"</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
                    <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-slate-700 mb-6 shadow-sm">
                      <span className="font-bold block text-yellow-700 mb-1 flex items-center gap-1">
                        📌 הקשר לשיחה:
                      </span>
                      "{activeThread.selected_text}"
                    </div>

                    {activeThread.messages?.map((msg) => (
                      <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                        }`}>
                          {msg.role === 'user' ? <UserIcon size={16}/> : <Bot size={16}/>}
                        </div>
                        <div className={`p-3 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm ${
                          msg.role === 'user' 
                            ? 'bg-blue-600 text-white rounded-tr-none' 
                            : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                        }`}>
                          {/* כאן הקסם: שימוש בפלאגינים למתמטיקה */}
                          <ReactMarkdown 
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                                strong: ({node, ...props}) => <span className={`font-bold ${msg.role === 'user' ? 'text-white' : 'text-indigo-700'}`} {...props} />,
                                ul: ({node, ...props}) => <ul className="list-disc list-inside space-y-1 mt-1" {...props} />,
                                ol: ({node, ...props}) => <ol className="list-decimal list-inside space-y-1 mt-1" {...props} />,
                                li: ({node, ...props}) => <li className="marker:opacity-50" {...props} />,
                                p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ))}
                    
                    {isSending && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center"><Bot size={16}/></div>
                        <div className="bg-white border p-3 rounded-2xl rounded-tl-none text-slate-500 text-sm flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin"/> חושב...
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 bg-white border-t flex gap-2 shrink-0">
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="המשך את השיחה..."
                      className="flex-1 border border-slate-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    <button 
                      onClick={handleSendMessage}
                      disabled={!inputMessage.trim() || isSending}
                      className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        )}

      </main>
    </div>
  )
}

export default App