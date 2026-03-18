import React from 'react';
import { ChevronLeft, GitBranch, LayoutList, MessageSquare } from 'lucide-react';
import type { Thread } from '../types'; 
import type { TreeStrategyProps } from './mockTreeData'; 

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
        <div className="flex flex-wrap items-center gap-1.5 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          <button 
            onClick={() => onSelectThread(null as any)}
            className="text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors"
          >
            ראשי
          </button>
          
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.id}>
              <ChevronLeft size={14} className="text-slate-400" />
              <button
                onClick={() => onSelectThread(crumb)}
                className={`text-xs px-2 py-1 rounded-md max-w-[120px] truncate transition-colors ${
                  index === breadcrumbs.length - 1 
                    ? 'bg-blue-100 text-blue-700 font-bold' 
                    : 'text-slate-600 hover:bg-slate-100'
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
        <h3 className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1">
          <LayoutList size={14} />
          {activeThread ? 'ענפים מתוך שיחה זו:' : 'שיחות מרכזיות במסמך:'}
        </h3>
        
        {visibleOptions.length === 0 ? (
          <div className="text-sm text-slate-400 p-4 text-center border border-dashed border-slate-200 rounded-lg bg-white">
            אין ענפים מפוצלים משיחה זו.
          </div>
        ) : (
          <div className="space-y-2">
            {visibleOptions.map(option => (
              <div
                key={option.id}
                onDoubleClick={() => onEnterChat(option)}
                className="w-full flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all group cursor-pointer"
              >
                <div 
                  className="flex items-center gap-2 flex-1 overflow-hidden"
                  onClick={() => onSelectThread(option)}
                >
                  <span className="shrink-0 text-[16px] leading-none">{option.emoji || '💬'}</span>
                  <span className="text-sm text-slate-700 font-medium line-clamp-2" dir="auto">
                    {option.title || option.selected_text}
                  </span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation(); 
                    onEnterChat(option);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 ml-1 bg-slate-50 text-blue-600 border border-blue-200 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold transition-all opacity-0 group-hover:opacity-100 shrink-0 shadow-sm"
                >
                  <MessageSquare size={14} />
                  לצ'אט
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};