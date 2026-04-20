import { BookOpen, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

interface ResumeToastProps {
  personaName: string | null;
  documentTitle: string | null;
  onResume: () => void;
  onDismiss: () => void;
}

export default function ResumeToast({
  personaName,
  documentTitle,
  onResume,
  onDismiss,
}: ResumeToastProps) {
  return (
    <div className="fixed bottom-5 start-[calc(15rem+1.25rem)] z-[300] w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-white border border-[#E8E8E6] rounded-xl shadow-lg p-4 flex flex-col gap-3">

        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#37352F] leading-tight">
                Resume last session?
              </p>
              {(personaName || documentTitle) && (
                <p className="text-[10px] text-[#787774] mt-0.5 truncate">
                  {[personaName, documentTitle].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 rounded-md text-[#C4C4C4] hover:text-[#787774] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            className="flex-1 py-1.5 text-xs font-medium text-[#787774] hover:text-[#37352F] bg-[#F7F7F5] hover:bg-[#EFEFED] rounded-lg transition-colors duration-150"
          >
            Dismiss
          </button>
          <button
            onClick={onResume}
            className="flex-1 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
          >
            Resume
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Convenience wrapper that reads from store ─────────────────────────────

interface ResumeToastContainerProps {
  personaName: string | null;
  documentTitle: string | null;
  onResume: () => void;
}

export function ResumeToastContainer({ personaName, documentTitle, onResume }: ResumeToastContainerProps) {
  const showResumePrompt    = useAppStore(state => state.showResumePrompt);
  const dismissResumePrompt = useAppStore(state => state.dismissResumePrompt);

  if (!showResumePrompt) return null;

  return (
    <ResumeToast
      personaName={personaName}
      documentTitle={documentTitle}
      onResume={() => { onResume(); dismissResumePrompt(); }}
      onDismiss={dismissResumePrompt}
    />
  );
}
