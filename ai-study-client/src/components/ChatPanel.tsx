import React, { useState } from 'react';
import { Send, Bot, User as UserIcon, MessageSquare, GitBranch, Network } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import type { Thread, Message } from '../types';

import { mockThreads } from './mockTreeData';
import { BreadcrumbTree } from './BreadcrumbTree';
import { MillerColumnsTree } from './MillerColumnsTree';
import { NodeGraphTree } from './NodeGraphTree';

interface ChatPanelProps {
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
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  activeThread,
  threads,
  setActiveThread,
  inputMessage,
  setInputMessage,
  handleSendMessage,
  isSending,
  onForkMessage,
  pendingForkMsgId,
  treeViewMode
}) => {
  const [activeTab, setActiveTab] = useState<'tree' | 'chat'>('tree');

  // פונקציית הניווט בעץ (לא מעבירה לצ'אט!)
  const handleSelectThread = (thread: Thread) => {
    setActiveThread(thread);
  };

  // פונקציה חדשה: כניסה ישירה לצ'אט הפעיל
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
    <div className="w-1/3 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden h-full max-h-full transition-all">
      <div className="flex bg-slate-50 border-b border-slate-200 shrink-0">
        <button 
          onClick={() => setActiveTab('tree')}
          className={`flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-bold border-b-2 transition-colors ${
            activeTab === 'tree' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Network className="w-4 h-4"/> עץ שיחות (Mock)
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          disabled={!activeThread}
          className={`flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-bold border-b-2 transition-colors ${
            !activeThread ? 'opacity-40 cursor-not-allowed text-slate-400' : 
            activeTab === 'chat' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'
          }`}
        >
          <MessageSquare className="w-4 h-4"/> צ'אט פעיל
        </button>
      </div>

      {activeTab === 'tree' ? (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-slate-50/30">
{/* הנתב החכם שלנו שבוחר את התצוגה לפי בחירת המשתמש */}
          {(() => {
            const strategyProps = {
              threads: mockThreads,
              activeThread,
              onSelectThread: handleSelectThread,
              onEnterChat: handleEnterChat
            };

            switch (treeViewMode) {
              case 'breadcrumbs':
                return <BreadcrumbTree {...strategyProps} />;
              case 'graph':
                return <NodeGraphTree {...strategyProps} />;
              case 'miller':
              default:
                return <MillerColumnsTree {...strategyProps} />;
            }
          })()}

        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            {activeThread && (
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-slate-700 mb-6 shadow-sm">
                <span className="font-bold block text-yellow-700 mb-1">📌 הקשר לשיחה (סומן בטקסט):</span>
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
                         {historicalMsgs.map(msg => renderMessage(msg, mockThreads, activeThread!, setActiveThread, onForkMessage, pendingForkMsgId))}
                      </div>
                    </details>
                  )}

                  {currentMsgs?.map(msg => renderMessage(msg, mockThreads, activeThread!, setActiveThread, onForkMessage, pendingForkMsgId))}
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