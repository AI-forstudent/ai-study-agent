import React from 'react';
import { ChevronLeft, LayoutList, MessageSquare } from 'lucide-react';
import type { Thread } from '../../../types';

interface TreeStrategyProps {
  threads: Thread[];
  activeThread: Thread | null;
  onSelectThread: (thread: Thread) => void;
  onEnterChat: (thread: Thread) => void;
}

export const BreadcrumbTree: React.FC<TreeStrategyProps> = ({ threads, activeThread, onSelectThread, onEnterChat }) => {
  const getBreadcrumbs = (current: Thread | null): Thread[] => {
    if (!current) return [];
    const path: Thread[] = [];
    let node: Thread | undefined = current;
    while (node) {
      path.unshift(node);
      node = threads.find(t => t.id === node!.parent_thread_id);
    }
    return path;
  };

  const breadcrumbs = getBreadcrumbs(activeThread);

  const visibleOptions = activeThread
    ? threads.filter(t => t.parent_thread_id === activeThread.id)
    : threads.filter(t => !t.parent_thread_id);

  return (
    <div className="flex flex-col h-full space-y-4" dir="rtl">
      {breadcrumbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 p-3 bg-white border border-[#E8E8E6] rounded-lg">
          <button
            onClick={() => onSelectThread(null as any)}
            className="text-xs font-medium text-[#787774] hover:text-indigo-600 transition-colors duration-150"
          >
            Home
          </button>

          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.id}>
              <ChevronLeft size={14} className="text-slate-400" />
              <button
                onClick={() => onSelectThread(crumb)}
                className={`text-xs px-2 py-1 rounded-md max-w-[120px] truncate transition-colors duration-150 ${
                  index === breadcrumbs.length - 1
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-[#787774] hover:bg-[#EFEFED]'
                }`}
                title={crumb.title || crumb.selected_text}
              >
                {crumb.title || crumb.selected_text}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        <h3 className="text-xs font-medium text-[#C4C4C4] mb-2 flex items-center gap-1">
          <LayoutList size={14} />
          {activeThread ? 'Branches from this thread:' : 'Main threads:'}
        </h3>

        {visibleOptions.length === 0 ? (
          <div className="text-sm text-[#C4C4C4] p-4 text-center border border-dashed border-[#E8E8E6] rounded-lg bg-white">
            No branches from this thread.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleOptions.map(option => (
              <div
                key={option.id}
                onDoubleClick={() => onEnterChat(option)}
                className="w-full flex items-center justify-between p-3 bg-white border border-[#E8E8E6] rounded-lg hover:border-indigo-300 transition-all duration-150 group cursor-pointer"
              >
                <div
                  className="flex items-center gap-2 flex-1 overflow-hidden"
                  onClick={() => onSelectThread(option)}
                >
                  <span className="shrink-0 text-[16px] leading-none">{option.emoji || '💬'}</span>
                  <span className="text-sm text-[#787774] font-medium line-clamp-2" dir="auto">
                    {option.title || option.selected_text}
                  </span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnterChat(option);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 ms-1 text-indigo-600 border border-indigo-200 hover:bg-indigo-600 hover:text-white rounded-md text-xs font-medium transition-all duration-150 opacity-0 group-hover:opacity-100 shrink-0"
                >
                  <MessageSquare size={14} />
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
