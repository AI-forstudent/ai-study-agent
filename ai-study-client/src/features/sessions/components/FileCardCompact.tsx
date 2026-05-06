import { Trash2, Star } from 'lucide-react';
import { FileIcon } from '../../../utils/fileIcons';

interface FileCardCompactProps {
  file: {
    file_id: number;
    file_title: string;
    file_doc_type: string;
    is_starred: boolean;
    is_public: boolean;
  };
  sortAt?: string;
  onOpen: (fileId: number) => void;
  onDelete?: (fileId: number, title: string) => void;
  onStar?: (fileId: number, isStarred: boolean) => void;
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diff = (now - then) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Compact horizontal-lane file card. Shares the lane with SessionCard so
 * Sessions and Files render at the same width (w-64).
 */
export default function FileCardCompact({
  file, sortAt, onOpen, onDelete, onStar,
}: FileCardCompactProps) {
  return (
    <div
      onClick={() => onOpen(file.file_id)}
      className="group shrink-0 w-64 bg-white border border-[#E8E8E6] rounded-xl p-4 cursor-pointer hover:border-[#C4C4C4] hover:shadow-sm transition-all duration-150 flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
          <FileIcon filename={file.file_title} className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#37352F] leading-snug truncate" title={file.file_title}>
            {file.file_title}
          </p>
          <p className="text-[10px] text-[#787774] mt-0.5">
            {file.file_doc_type === 'SOURCE_CODE' ? 'Source code' : 'Document'}
          </p>
        </div>
      </div>

      <p className="text-xs text-[#C4C4C4] italic line-clamp-2 leading-relaxed flex-1 min-h-[2.4rem]">
        Click to open in the workspace.
      </p>

      <div className="flex items-center justify-between pt-2 border-t border-[#E8E8E6] text-[10px] text-[#C4C4C4]">
        <span>{relativeTime(sortAt)}</span>
        <span className="flex items-center gap-1">
          {onStar && (
            <button
              onClick={e => { e.stopPropagation(); onStar(file.file_id, !file.is_starred); }}
              title={file.is_starred ? 'Remove star' : 'Star'}
              className="p-1 rounded-md hover:bg-amber-50 transition-colors duration-150"
            >
              <Star
                className={`w-3 h-3 ${file.is_starred ? 'text-amber-400 fill-amber-400' : 'text-[#C4C4C4]'}`}
              />
            </button>
          )}
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(file.file_id, file.file_title); }}
              title="Delete file"
              className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[#C4C4C4] hover:text-red-500 hover:bg-red-50 transition-all duration-150"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
