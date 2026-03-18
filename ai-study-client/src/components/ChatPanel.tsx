import React, { useState } from 'react';
import { Send, Bot, User as UserIcon, MessageSquare, GitBranch, Network, FileText, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import type { Thread, Message } from '../types';
import { mockThreads } from './mockTreeData';
import { BreadcrumbTree } from './BreadcrumbTree';
import { MillerColumnsTree } from './MillerColumnsTree';
import { NodeGraphTree } from './NodeGraphTree';
import { api } from '../services/api';

interface ChatPanelProps {
  documentId: number | null;
  activeThread: Thread | null;
  threads: Thread[]; 
  setActiveThread: (thread: Thread | null) => void;
  inputMessage: string;
  setInputMessage: (msg: string) => void;
  handleSendMessage: () => void;
  isSending: boolean;
  onForkMessage: (messageId: number) => void;
  pendingForkMsgId: number | null;
  treeViewMode: 'miller' | 'breadcrumbs' | 'graph';
  currentPage: number; // <-- מגיע מ-App כדי לדעת איזה סיכום להציג
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  documentId,
  activeThread,
  threads,
  setActiveThread,
  inputMessage,
  setInputMessage,
  handleSendMessage,
  isSending,
  onForkMessage,
  pendingForkMsgId,
  treeViewMode,
  currentPage
}) => {
  // הוספנו את 'summary' לטאבים האפשריים!
  const [activeTab, setActiveTab] = useState<'tree' | 'chat' | 'summary'>('tree');

  // --- סטייטים חדשים לסיכום העמוד ---
  const [pageSummaries, setPageSummaries] = useState<Record<number, string>>({}); // שומר סיכומים בזיכרון לפי מספר עמוד
  const [isEstimating, setIsEstimating] = useState(false);
  const [tokenEstimate, setTokenEstimate] = useState<number | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  // מאפס את חלונית האישור כשעוברים עמוד
  React.useEffect(() => {
    setTokenEstimate(null);
  }, [currentPage]);

  const handleEstimateTokens = async () => {
    if (!documentId) return;
    setIsEstimating(true);
    try {
      // קריאה לבקאנד רק כדי לבדוק כמה זה יעלה (חינמי מג'ימיני)
      const res = await api.estimatePageSummaryTokens(documentId, currentPage);
      setTokenEstimate(res.data.tokens);
    } catch (err) {
      alert("שגיאה בהערכת טוקנים - ודא שיש טקסט בעמוד הזה.");
    } finally {
      setIsEstimating(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!documentId) return;
    setIsGeneratingSummary(true);
    setTokenEstimate(null); // מעלים את חלונית האישור
    try {
      // הפקודה האמיתית שעולה כסף
      const res = await api.createPageSummary(documentId, currentPage);
      // שומרים את התשובה בזיכרון תחת מספר העמוד הנוכחי
      setPageSummaries(prev => ({ ...prev, [currentPage]: res.data.summary }));
    } catch (err) {
      alert("שגיאה ביצירת הסיכום.");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSelectThread = (thread: Thread) => {
    setActiveThread(thread);
  };
  // מאזין חכם: אם נבחרה שיחה אקטיבית חדשה (למשל מלחיצה על מרקר ב-PDF), 
// תקפוץ אוטומטית לטאב של הצ'אט!
React.useEffect(() => {
  if (activeThread) {
    setActiveTab('chat');
  }
}, [activeThread]);

  const handleEnterChat = (thread: Thread) => {
    setActiveThread(thread);
    setActiveTab('chat');
  };

  const renderMessage = (msg: Message, allThreads: Thread[], currentThread: Thread, setThread: Function, forkHandler: Function, pendingId: number | null) => (
    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
        msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
      }`}>
        {msg.role === 'user' ? <UserIcon size={16}/> : <Bot size={16}/>}
      </div>
      
      <div className="flex flex-col gap-2 max-w-[85%]">
        <div className={`p-3.5 text-sm shadow-sm ${
          msg.role === 'user' 
            ? 'bg-blue-600 text-white rounded-2xl rounded-tr-none whitespace-pre-wrap' 
            : 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-none prose prose-slate prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0'
        }`}>
          <ReactMarkdown 
            remarkPlugins={[remarkMath, remarkGfm]} 
            rehypePlugins={[rehypeKatex]}
            components={{
              p: ({node, ...props}) => <p dir="auto" {...props} />,
              li: ({node, ...props}) => <li dir="auto" {...props} />,
              table: ({node, ...props}) => (
                <div className="overflow-x-auto my-4">
                  <table className="border-collapse border border-slate-300 w-full shadow-sm rounded-lg" {...props} />
                </div>
              ),
              th: ({node, ...props}) => (
                <th dir="auto" className="border border-slate-300 bg-slate-50 p-2 font-bold text-slate-700 text-start" {...props} />
              ),
              td: ({node, ...props}) => (
                <td dir="auto" className="border border-slate-300 p-2 text-slate-600 text-start" {...props} />
              )
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>

        {msg.role === 'assistant' && (
          <div className="flex justify-start mr-1">
            {(() => {
              const isForkActiveInDB = currentThread.forked_from_message_id === msg.id;
              const isPendingFork = pendingId === msg.id;

              let btnClass = 'bg-white text-slate-500 border border-slate-200 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 shadow-sm opacity-85 hover:opacity-100';
              let btnText = 'פצל שיחה (הדלקה)';
              let btnTitle = 'הדלק פיצול (צור ענף חדש מפה)';
              let onClickHandler = () => forkHandler(msg.id);

              if (isForkActiveInDB) {
                btnClass = 'bg-purple-100 text-purple-700 border border-purple-300 shadow-sm ring-2 ring-purple-100/50';
                btnText = 'פיצול פעיל (כיבוי וחזרה)';
                btnTitle = 'כבה פיצול (חזור לשיחה המקורית)';
                onClickHandler = () => {
                  const parent = allThreads.find(t => t.id === currentThread.parent_thread_id);
                  if (parent) setThread(parent);
                };
              } else if (isPendingFork) {
                btnClass = 'bg-amber-100 text-amber-700 border border-amber-300 shadow-sm ring-2 ring-amber-100/50';
                btnText = 'ממתין לפיצול (לחץ לביטול)';
                btnTitle = 'בטל פיצול מתוכנן';
                onClickHandler = () => forkHandler(msg.id);
              }

              return (
                <button 
                  onClick={onClickHandler}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all duration-300 ${btnClass}`}
                  title={btnTitle}
                >
                  <GitBranch size={13} /> 
                  {btnText}
                </button>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden h-full max-h-full transition-all">      {/* אזור הטאבים עודכן כדי להכיל 3 כפתורים */}
      <div className="flex bg-slate-50 border-b border-slate-200 shrink-0">
        <button 
          onClick={() => setActiveTab('tree')}
          className={`flex-1 py-3.5 flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'tree' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Network className="w-4 h-4"/> עץ שיחות
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          disabled={!activeThread}
          className={`flex-1 py-3.5 flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold border-b-2 transition-colors ${
            !activeThread ? 'opacity-40 cursor-not-allowed text-slate-400' : 
            activeTab === 'chat' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'
          }`}
        >
          <MessageSquare className="w-4 h-4"/> צ'אט פעיל
        </button>
        <button 
          onClick={() => setActiveTab('summary')}
          className={`flex-1 py-3.5 flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'summary' ? 'border-purple-600 text-purple-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4"/> סיכום עמוד
        </button>
      </div>

      {/* הרינדור המרכזי לפי הטאב הנבחר */}
      {activeTab === 'tree' && (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-slate-50/30">
          {(() => {
            const strategyProps = {
              threads,
              activeThread,
              onSelectThread: handleSelectThread,
              onEnterChat: handleEnterChat
            };

            switch (treeViewMode) {
              case 'breadcrumbs': return <BreadcrumbTree {...strategyProps} />;
              case 'graph': return <NodeGraphTree {...strategyProps} />;
              case 'miller':
              default: return <MillerColumnsTree {...strategyProps} />;
            }
          })()}
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-purple-50/30">
          <div className="bg-white rounded-xl border border-purple-100 shadow-sm p-6 mb-4">
            <h3 className="text-lg font-bold text-purple-800 mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500"/>
              סיכום עמוד {currentPage}
            </h3>
            
            {/* 1. מצב התחלתי: כפתור בקשת סיכום (מביא הערכת טוקנים) */}
            {!pageSummaries[currentPage] && !isGeneratingSummary && tokenEstimate === null && (
              <div className="mt-8 text-center">
                <p className="text-sm text-slate-500 mb-6">עדיין לא נוצר סיכום לעמוד זה. ג'ימיני יכול לנתח אותו עבורך.</p>
                <button 
                  onClick={handleEstimateTokens}
                  disabled={isEstimating}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-6 rounded-xl flex items-center gap-2 mx-auto transition-colors disabled:opacity-50 shadow-sm"
                >
                  {isEstimating ? <Loader2 className="w-5 h-5 animate-spin"/> : <Sparkles className="w-5 h-5"/>}
                  {isEstimating ? "מחשב עלויות..." : "בקש סיכום עמוד (הערכת עלות)"}
                </button>
              </div>
            )}

            {/* 2. מצב שומר הסף: מציג כמה טוקנים זה עולה ומבקש אישור */}
            {tokenEstimate !== null && !isGeneratingSummary && !pageSummaries[currentPage] && (
              <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-5 text-center shadow-sm animate-in fade-in zoom-in-95 duration-200">
                <p className="text-sm font-bold text-amber-800 mb-2">
                  ⚠️ הפעולה תדרוש כ-{tokenEstimate} טוקנים מול ה-API של ג'ימיני.
                </p>
                <p className="text-xs text-amber-700/80 mb-5">האם ברצונך לאשר את השליחה?</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setTokenEstimate(null)} className="text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 px-5 py-2 rounded-lg text-sm font-bold transition-colors">
                    ביטול
                  </button>
                  <button onClick={handleGenerateSummary} className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2">
                    <Sparkles className="w-4 h-4"/> אשר וסכם
                  </button>
                </div>
              </div>
            )}

            {/* 3. מצב המתנה: מציג אנימציית שלד (Skeleton) בזמן שג'ימיני חושב */}
            {isGeneratingSummary && (
              <div className="mt-8 space-y-4">
                <div className="flex items-center gap-2 text-purple-600 font-bold mb-6">
                  <Loader2 className="w-5 h-5 animate-spin"/> ג'ימיני כותב סיכום ממוקד...
                </div>
                <div className="h-4 bg-purple-100 rounded-full w-full animate-pulse"></div>
                <div className="h-4 bg-purple-100 rounded-full w-5/6 animate-pulse"></div>
                <div className="h-4 bg-purple-100 rounded-full w-4/6 animate-pulse"></div>
              </div>
            )}

            {/* 4. מצב סיום: מציג את התוצאה עם תמיכה ב-Markdown מלא! */}
            {pageSummaries[currentPage] && (
              <div className="mt-6 bg-slate-50 p-4 rounded-xl border border-slate-100 prose prose-purple prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-purple-900 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <ReactMarkdown 
                  remarkPlugins={[remarkMath, remarkGfm]} 
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    p: ({node, ...props}) => <p dir="auto" {...props} />,
                    li: ({node, ...props}) => <li dir="auto" {...props} />,
                    h1: ({node, ...props}) => <h1 dir="auto" className="text-xl font-bold mt-4 mb-2" {...props} />,
                    h2: ({node, ...props}) => <h2 dir="auto" className="text-lg font-bold mt-3 mb-2" {...props} />,
                    h3: ({node, ...props}) => <h3 dir="auto" className="text-base font-bold mt-2 mb-1" {...props} />,
                    strong: ({node, ...props}) => <strong className="text-purple-800 font-bold" {...props} />
                  }}
                >
                  {pageSummaries[currentPage]}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {activeThread && (
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-slate-700 mb-6 shadow-sm">
                <span className="font-bold block text-yellow-700 mb-1">
                  {activeThread.emoji || '📌'} הקשר לשיחה (סומן בטקסט):
                </span>
                "{activeThread.selected_text}"
              </div>
            )}

            {(() => {
              const forkId = activeThread?.forked_from_message_id;
              const historicalMsgs = forkId ? activeThread?.messages?.filter(m => m.id <= forkId) : [];
              const currentMsgs = forkId ? activeThread?.messages?.filter(m => m.id > forkId) : activeThread?.messages;

              return (
                <>
                  {historicalMsgs && historicalMsgs.length > 0 && (
                    <details className="group mb-6">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-500 bg-slate-200/60 hover:bg-slate-200 px-4 py-2 rounded-full mx-auto w-fit transition-colors flex items-center gap-2">
                        <span>👀 צפה בהיסטוריית השיחה הקודמת ({historicalMsgs.length} הודעות)</span>
                        <Network size={14} className="group-open:rotate-180 transition-transform"/>
                      </summary>
                      <div className="mt-4 space-y-4 opacity-70 border-r-2 border-slate-300 pr-4 mr-2">
                         {historicalMsgs.map(msg => renderMessage(msg, threads, activeThread!, setActiveThread, onForkMessage, pendingForkMsgId))}
                      </div>
                    </details>
                  )}

                  {currentMsgs?.map(msg => renderMessage(msg, threads, activeThread!, setActiveThread, onForkMessage, pendingForkMsgId))}
                </>
              );
            })()}

            {isSending && (
              <div className="flex gap-3 animate-in fade-in duration-300">
                <div className="w-8 h-8 bg-purple-100 text-purple-300 rounded-full flex items-center justify-center shrink-0 shadow-sm">
                  <Bot size={16}/>
                </div>
                <div className="p-4 rounded-2xl w-full max-w-[85%] bg-white border border-slate-200 rounded-tl-none shadow-sm">
                  <div className="animate-pulse flex flex-col gap-3">
                    <div className="h-2.5 bg-slate-200 rounded-full w-3/4"></div>
                    <div className="h-2.5 bg-slate-200 rounded-full w-full"></div>
                    <div className="h-2.5 bg-slate-200 rounded-full w-1/2"></div>
                  </div>
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
              className="flex-1 border border-slate-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
            />
            <button onClick={handleSendMessage} disabled={!inputMessage.trim() || isSending} className="bg-blue-600 text-white p-2.5 rounded-full hover:bg-blue-700 disabled:opacity-50 shadow-sm transition-colors">
              <Send className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatPanel;