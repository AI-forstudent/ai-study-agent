import React from 'react';
import { GitBranch, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import type { Thread } from '../types';
import type { TreeStrategyProps } from './mockTreeData';

export const MillerColumnsTree: React.FC<TreeStrategyProps> = ({ 
  threads, 
  activeThread, 
  onSelectThread, 
  onEnterChat 
}) => {
  // 1. מציאת מסלול הניווט
  const getPath = (current: Thread | null): Thread[] => {
    if (!current) return [];
    const path: Thread[] = [];
    let node: Thread | undefined = current;
    while (node) {
      path.unshift(node);
      node = threads.find(t => t.id === node!.parent_thread_id);
    }
    return path;
  };

  const path = getPath(activeThread);

  // 2. בניית העמודות
  const columns: Thread[][] = [];
  columns.push(threads.filter(t => !t.parent_thread_id));

  path.forEach(node => {
    const children = threads.filter(t => t.parent_thread_id === node.id);
    if (children.length > 0) {
      columns.push(children);
    }
  });

  // פונקציה חכמה לטיפול בלחיצה - מאפשרת סגירה של רמה!
  const handleRowClick = (thread: Thread) => {
    // אם לחצנו בדיוק על אותה שיחה שכבר פתוחה עכשיו -> נסגור אותה ונחזור לאבא שלה
    if (activeThread && activeThread.id === thread.id) {
      const parent = threads.find(t => t.id === thread.parent_thread_id);
      onSelectThread((parent as Thread) || (null as any));
    } else {
      // אחרת, פשוט נפתח את השיחה שלחצנו עליה
      onSelectThread(thread);
    }
  };

  return (
    <div className="flex h-full w-full overflow-x-auto gap-3 pb-2 custom-scrollbar" dir="rtl">
      {columns.map((colThreads, colIndex) => {
        const activeNodeInThisCol = path.find(p => colThreads.some(t => t.id === p.id));

        return (
          <div key={colIndex} className="flex-shrink-0 w-56 border border-slate-200 rounded-lg bg-white overflow-y-auto flex flex-col shadow-sm">
            <div className="bg-slate-50 border-b border-slate-200 p-2 text-xs font-bold text-slate-500 sticky top-0 z-10">
              {colIndex === 0 ? 'שיחות ראשיות' : `רמה ${colIndex}`}
            </div>
            <div className="p-1.5 space-y-1">
              {colThreads.map(thread => {
                // האם השיחה הזו היא חלק מ*שובל* הניווט שלנו? (האבות)
                const isPathActive = activeNodeInThisCol?.id === thread.id;
                // האם השיחה הזו היא התחנה ה*סופית* שלנו כרגע?
                const isLeafActive = activeThread?.id === thread.id;
                const hasChildren = threads.some(t => t.parent_thread_id === thread.id);

                // קביעת העיצוב: חזק לתחנה הסופית, חלש לשובל, רגיל לשאר
                let rowClass = 'hover:bg-slate-50 border-transparent';
                if (isLeafActive) {
                  rowClass = 'bg-blue-50 border-blue-300 shadow-sm ring-1 ring-blue-200'; 
                } else if (isPathActive) {
                  rowClass = 'bg-slate-100 border-slate-200'; 
                }

                return (
                  <div
                    key={thread.id}
                    onDoubleClick={() => onEnterChat(thread)}
                    className={`w-full flex flex-col p-2 rounded-md transition-all group cursor-pointer border ${rowClass}`}
                  >
                    {/* אזור הניווט */}
                    <div 
                      className="flex items-start justify-between gap-1.5"
                      onClick={() => handleRowClick(thread)}
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden flex-1">
                        <span className="shrink-0 text-[14px] mt-0.5">{thread.emoji || '💬'}</span>
                        <span className={`text-xs line-clamp-2 ${isLeafActive ? 'text-blue-800 font-bold' : isPathActive ? 'text-blue-700 font-medium' : 'text-slate-600 font-medium'}`} dir="auto">
                          {thread.title || thread.selected_text}
                        </span>
                      </div>
                      
                      {/* החץ החכם: למטה אם פתוח, שמאלה אם סגור */}
                      {hasChildren && (
                        isPathActive ? (
                          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500 transition-transform" />
                        ) : (
                          <ChevronLeft size={14} className="shrink-0 mt-0.5 text-slate-300 group-hover:text-slate-400 transition-transform" />
                        )
                      )}
                    </div>

                    {/* כפתור הכניסה לצ'אט */}
                    <div className={`mt-2 h-6 flex justify-end ${isLeafActive ? 'block' : 'hidden group-hover:flex'}`}>
                       <button
                        onClick={(e) => {
                          e.stopPropagation(); 
                          onEnterChat(thread);
                        }}
                        className={`flex items-center gap-1 px-2 py-1 bg-white text-blue-600 border border-blue-200 hover:bg-blue-600 hover:text-white rounded text-[10px] font-bold transition-all shadow-sm ${
                          isLeafActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <MessageSquare size={12} />
                        לצ'אט
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};