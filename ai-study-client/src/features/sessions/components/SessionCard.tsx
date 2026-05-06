import { MessageSquare, FileText, Trash2 } from 'lucide-react';
import type { LibraryFeedItem } from '../../../types/course';

interface SessionCardProps {
  /** Either a session row from /library/recent or a SessionCard from /sessions. */
  session: Extract<LibraryFeedItem, { kind: 'session' }> | {
    session_id: number;
    session_title: string | null;
    session_emoji: string | null;
    session_preview: string | null;
    message_count: number;
    document_id: number | null;
    document_title: string | null;
  };
  onOpen: (sessionId: number) => void;
  onDelete?: (sessionId: number) => void;
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

export default function SessionCard({ session, onOpen, onDelete }: SessionCardProps) {
  const sortAt = 'sort_at' in session ? session.sort_at : undefined;
  const title = session.session_title ?? 'Untitled session';
  const emoji = session.session_emoji ?? '💬';
  const preview = session.session_preview ?? 'No messages yet.';
  const docTitle = session.document_title;

  return (
    <div
      onClick={() => onOpen(session.session_id)}
      className="group shrink-0 w-64 bg-white border border-[#E8E8E6] rounded-xl p-4 cursor-pointer hover:border-[#C4C4C4] hover:shadow-sm transition-all duration-150 flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-lg shrink-0 select-none">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#37352F] leading-snug truncate" title={title}>
            {title}
          </p>
          {docTitle ? (
            <p className="flex items-center gap-1 text-[10px] text-[#787774] mt-0.5 truncate">
              <FileText className="w-3 h-3 shrink-0" />
              {docTitle}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-[10px] text-indigo-500 mt-0.5">
              <MessageSquare className="w-3 h-3 shrink-0" />
              Standalone chat
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-[#787774] line-clamp-2 leading-relaxed flex-1 min-h-[2.4rem]">
        {preview}
      </p>

      <div className="flex items-center justify-between pt-2 border-t border-[#E8E8E6] text-[10px] text-[#C4C4C4]">
        <span>{session.message_count} message{session.message_count === 1 ? '' : 's'}</span>
        <span className="flex items-center gap-2">
          <span>{relativeTime(sortAt)}</span>
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(session.session_id); }}
              title="Delete session"
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
