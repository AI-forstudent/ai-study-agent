import { useState, useEffect } from 'react';
import { X, Loader2, Calendar, BookOpen } from 'lucide-react';

interface LectureModalProps {
  isOpen: boolean;
  /** Set to a partial lecture to open in edit mode; omit for create mode. */
  editing?: { id: number; title: string; lecture_date: string | null } | null;
  onClose: () => void;
  /** In create mode the parent translates this to api.createCourseLecture; in
   *  edit mode it calls api.updateLecture(editing.id, ...). The modal
   *  doesn't know about courseId — the parent owns that. */
  onSave: (payload: { title: string; lecture_date: string | null }) => Promise<void>;
}

/**
 * Lecture create / rename modal — Phase 1 minimal shape (title + date).
 * Manual summary, recording, and notes are managed from the detail view
 * since they need their own affordances (textarea, upload buttons).
 */
export default function LectureModal({ isOpen, editing, onClose, onSave }: LectureModalProps) {
  const [title, setTitle]       = useState('');
  const [lectureDate, setDate]  = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(editing?.title ?? '');
    setDate(editing?.lecture_date ?? '');
    setError(null);
  }, [isOpen, editing]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        lecture_date: lectureDate || null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save lecture.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[90dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#37352F] flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            {editing ? 'Edit lecture' : 'New lecture'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#787774] hover:bg-[#EFEFED] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#787774] mb-1.5">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Lecture 3 — Eigenvalues"
              autoFocus
              dir="auto"
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#787774] mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              Lecture date
            </label>
            <input
              type="date"
              value={lectureDate}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm text-[#37352F] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
            <p className="text-[10px] text-[#C4C4C4] mt-1">Optional — leave blank if you don't know the date.</p>
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Create lecture'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
