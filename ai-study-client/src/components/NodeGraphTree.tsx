import React from 'react';
import { GitBranch, MessageSquare, Network } from 'lucide-react';
import type { Thread } from '../types';
import type { TreeStrategyProps } from './mockTreeData';

export const NodeGraphTree: React.FC<TreeStrategyProps> = ({ 
  threads, 
  activeThread, 
  onSelectThread, 
  onEnterChat 
}) => {
  const rootThreads = threads.filter(t => !t.parent_thread_id);

  // פונקציית עזר לבדוק אם צומת מסוים הוא חלק ממסלול הניווט הפעיל
  const isNodeInPath = (node: Thread, target: Thread | null): boolean => {
    if (!target) return false;
    if (node.id === target.id) return true;
    let curr = target;
    while (curr.parent_thread_id) {
      if (curr.parent_thread_id === node.id) return true;
      curr = threads.find(t => t.id === curr.parent_thread_id)!;
      if (!curr) break;
    }
    return false;
  };

  // רכיב פנימי רקורסיבי לציור צומת (Node) בעץ
  const TreeNode = ({ thread, depth }: { thread: Thread, depth: number }) => {
    const children = threads.filter(t => t.parent_thread_id === thread.id);
    const isActive = activeThread?.id === thread.id;
    const isPath = isNodeInPath(thread, activeThread);

    return (
      <div className="relative mt-3">
        {/* קו חיבור אופקי לאבא (לא קיים בשורש) */}
        {depth > 0 && (
          <div className="absolute -right-5 top-5 w-5 h-px bg-slate-300" />
        )}

        {/* הקובייה של השיחה עצמה */}
        <div 
          onDoubleClick={() => onEnterChat(thread)}
          className={`relative z-10 p-3 rounded-xl border transition-all cursor-pointer group flex flex-col gap-2 w-full max-w-sm ${
            isActive 
              ? 'bg-blue-50 border-blue-400 shadow-md ring-2 ring-blue-100' 
              : isPath 
                ? 'bg-slate-50 border-slate-300 shadow-sm' 
                : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
          }`}
          onClick={() => onSelectThread(thread)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Network size={14} className={`shrink-0 ${isActive ? 'text-blue-600' : isPath ? 'text-blue-400' : 'text-slate-400'}`} />
              <span className={`text-sm ${isActive ? 'font-bold text-blue-800' : isPath ? 'font-bold text-slate-700' : 'text-slate-600 font-medium'}`} dir="auto">
                {thread.selected_text}
              </span>
            </div>
            
            <button
              onClick={(e) => {
                e.stopPropagation(); 
                onEnterChat(thread);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 bg-white text-blue-600 border border-blue-200 hover:bg-blue-600 hover:text-white rounded-md text-[11px] font-bold transition-all shadow-sm shrink-0 ${
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <MessageSquare size={12} />
              לצ'אט
            </button>
          </div>
        </div>

        {/* קריאה רקורסיבית לילדים */}
        {children.length > 0 && (
          <div className="relative pr-5">
            {/* הקו האנכי שמחבר בין הילדים לאבא */}
            <div className="absolute right-0 top-0 bottom-6 w-px bg-slate-300" />
            {children.map(child => (
              <TreeNode key={child.id} thread={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full w-full overflow-auto p-2 bg-slate-50/30" dir="rtl">
      {rootThreads.map(root => (
        <TreeNode key={root.id} thread={root} depth={0} />
      ))}
    </div>
  );
};