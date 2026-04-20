import React from 'react';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import type { Thread } from '../../../types';

interface TreeStrategyProps {
  threads: Thread[];
  activeThread: Thread | null;
  onSelectThread: (thread: Thread) => void;
  onEnterChat: (thread: Thread) => void;
}

export const MillerColumnsTree: React.FC<TreeStrategyProps> = ({
  threads,
  activeThread,
  onSelectThread,
  onEnterChat
}) => {
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

  const columns: Thread[][] = [];
  columns.push(threads.filter(t => !t.parent_thread_id));

  path.forEach(node => {
    const children = threads.filter(t => t.parent_thread_id === node.id);
    if (children.length > 0) {
      columns.push(children);
    }
  });

  const handleRowClick = (thread: Thread) => {
    if (activeThread && activeThread.id === thread.id) {
      const parent = threads.find(t => t.id === thread.parent_thread_id);
      onSelectThread((parent as Thread) || (null as any));
    } else {
      onSelectThread(thread);
    }
  };

  return (
    <div className="flex h-full w-full overflow-x-auto gap-3 pb-2 custom-scrollbar" dir="rtl">
      {columns.map((colThreads, colIndex) => {
        const activeNodeInThisCol = path.find(p => colThreads.some(t => t.id === p.id));

        return (
          <div key={colIndex} className="flex-shrink-0 w-56 border border-[#E8E8E6] rounded-lg bg-white overflow-y-auto flex flex-col shadow-sm">
            <div className="bg-[#F7F7F5] border-b border-[#E8E8E6] p-2 text-xs font-medium text-[#787774] sticky top-0 z-10">
              {colIndex === 0 ? 'Main Threads' : `Level ${colIndex}`}
            </div>
            <div className="p-1.5 space-y-1">
              {colThreads.map(thread => {
                const isPathActive = activeNodeInThisCol?.id === thread.id;
                const isLeafActive = activeThread?.id === thread.id;
                const hasChildren = threads.some(t => t.parent_thread_id === thread.id);

                let rowClass = 'hover:bg-[#F7F7F5] border-transparent';
                if (isLeafActive) {
                  rowClass = 'bg-indigo-50 border-indigo-200';
                } else if (isPathActive) {
                  rowClass = 'bg-[#EFEFED] border-[#E8E8E6]';
                }

                return (
                  <div
                    key={thread.id}
                    onDoubleClick={() => onEnterChat(thread)}
                    className={`w-full flex flex-col p-2 rounded-md transition-all group cursor-pointer border ${rowClass}`}
                  >
                    <div
                      className="flex items-start justify-between gap-1.5"
                      onClick={() => handleRowClick(thread)}
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden flex-1">
                        <span className="shrink-0 text-[14px] mt-0.5">{thread.emoji || '💬'}</span>
                        <span className={`text-xs line-clamp-2 ${isLeafActive ? 'text-[#37352F] font-semibold' : isPathActive ? 'text-[#37352F] font-medium' : 'text-[#787774] font-medium'}`} dir="auto">
                          {thread.title || thread.selected_text}
                        </span>
                      </div>

                      {hasChildren && (
                        isPathActive ? (
                          <ChevronRight size={14} className="shrink-0 mt-0.5 text-indigo-600 transition-transform" />
                        ) : (
                          <ChevronLeft size={14} className="shrink-0 mt-0.5 text-slate-300 group-hover:text-slate-400 transition-transform" />
                        )
                      )}
                    </div>

                    <div className={`mt-2 h-6 flex justify-end ${isLeafActive ? 'block' : 'hidden group-hover:flex'}`}>
                       <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEnterChat(thread);
                        }}
                        className={`flex items-center gap-1 px-2 py-1 text-indigo-600 border border-indigo-200 hover:bg-indigo-600 hover:text-white rounded text-[10px] font-medium transition-all ${
                          isLeafActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <MessageSquare size={12} />
                        Open
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
