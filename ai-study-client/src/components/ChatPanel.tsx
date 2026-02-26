import React from 'react';
import { Send, Bot, User as UserIcon, X, MessageSquare, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Thread } from '../types';

interface ChatPanelProps {
  activeThread: Thread | null;
  threads: Thread[];
  setActiveThread: (thread: Thread | null) => void;
  inputMessage: string;
  setInputMessage: (msg: string) => void;
  handleSendMessage: () => void;
  isSending: boolean;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  activeThread,
  threads,
  setActiveThread,
  inputMessage,
  setInputMessage,
  handleSendMessage,
  isSending
}) => {
  return (
    <div className="w-1/3 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden h-full max-h-full transition-all">
      {/* כותרת הפאנל */}
      <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
        <h2 className="font-bold text-slate-700 flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-600"/> 
          {activeThread ? "השיחה שלי" : "העוזר האישי"}
        </h2>
        {activeThread && (
          <button onClick={() => setActiveThread(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5"/>
          </button>
        )}
      </div>

      {!activeThread ? (
        /* מצב רשימת שיחות קודמות */
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center space-y-4">
              <div className="bg-slate-50 p-6 rounded-full"><MessageSquare className="w-10 h-10 opacity-50"/></div>
              <p className="text-lg">סמן טקסט ב-PDF כדי להתחיל</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-500 text-sm font-medium mb-2">שיחות קודמות:</p>
              {threads.map(t => (
                <div key={t.id} onClick={() => setActiveThread(t)} className="p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer transition-all">
                  <p className="text-slate-700 text-sm line-clamp-2 font-medium">"{t.selected_text}"</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* מצב שיחה פעילה */
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-slate-700 mb-6">
              <span className="font-bold block text-yellow-700 mb-1">📌 הקשר לשיחה:</span>
              "{activeThread.selected_text}"
            </div>

            {activeThread.messages?.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                }`}>
                  {msg.role === 'user' ? <UserIcon size={16}/> : <Bot size={16}/>}
                </div>
                <div className={`p-3 rounded-2xl max-w-[85%] text-sm shadow-sm ${
                  msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                }`}>
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            
            {isSending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center"><Bot size={16}/></div>
                <div className="bg-white border p-3 rounded-2xl text-slate-500 text-sm flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin"/> חושב...
                </div>
              </div>
            )}
          </div>

          {/* שדה קלט */}
          <div className="p-4 bg-white border-t flex gap-2 shrink-0">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="המשך את השיחה..."
              className="flex-1 border border-slate-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button onClick={handleSendMessage} disabled={!inputMessage.trim() || isSending} className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 disabled:opacity-50">
              <Send className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatPanel;