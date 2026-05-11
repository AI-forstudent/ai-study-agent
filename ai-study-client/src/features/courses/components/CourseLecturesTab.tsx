import { useEffect, useState } from 'react';
import {
  Plus, Mic, FileText, Image, BookOpen, Loader2, Calendar, AlertCircle,
} from 'lucide-react';
import { api } from '../../../services/api';
import LectureModal from './LectureModal';
import LectureSessionView, { type Lecture } from './LectureSessionView';

interface CourseLecturesTabProps {
  courseId: number;
  isOwner:  boolean;
}

/**
 * Lectures tab inside a Course (F-031 Phase 1).
 *
 * Two modes:
 *   • list:   cards grid + "+ New lecture" button (owner-only)
 *   • detail: a single Lecture rendered by LectureDetailView
 *
 * Phase 2 — DEFERRED:
 *   • Auto-transcription of recordings via Gemini audio.
 *   • Smart fused summary (transcript + notes + manual summary).
 */
export default function CourseLecturesTab({ courseId, isOwner }: CourseLecturesTabProps) {
  const [lectures, setLectures]     = useState<Lecture[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<Lecture | null>(null);
  const [activeId, setActiveId]     = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCourseLectures(courseId);
      setLectures(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to load lectures.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [courseId]);

  const active = activeId != null ? lectures.find(l => l.id === activeId) ?? null : null;

  async function handleSave(payload: { title: string; lecture_date: string | null }) {
    if (editing) {
      const res = await api.updateLecture(editing.id, payload);
      setLectures(prev => prev.map(l => l.id === editing.id ? res.data : l));
    } else {
      const res = await api.createCourseLecture(courseId, payload);
      setLectures(prev => [res.data, ...prev]);
    }
  }

  async function handleDelete(id: number) {
    await api.deleteLecture(id);
    setLectures(prev => prev.filter(l => l.id !== id));
    setActiveId(null);
  }

  // ── Detail mode ───────────────────────────────────────────────────────
  if (active) {
    return (
      <>
        <LectureSessionView
          lecture={active}
          isOwner={isOwner}
          onBack={() => setActiveId(null)}
          onChange={updated => {
            setLectures(prev => prev.map(l => l.id === updated.id ? updated : l));
          }}
          onDelete={() => handleDelete(active.id)}
          onRename={() => { setEditing(active); setModalOpen(true); }}
        />
        <LectureModal
          isOpen={modalOpen}
          editing={editing ? { id: editing.id, title: editing.title, lecture_date: editing.lecture_date } : null}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={handleSave}
        />
      </>
    );
  }

  // ── List mode ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#37352F]">
            Lectures <span className="text-sm font-normal text-[#C4C4C4]">({lectures.length})</span>
          </h2>
          <p className="text-xs text-[#787774] mt-0.5">
            Each lecture can carry a recording, notes, and a written summary.
          </p>
        </div>
        {isOwner && (
          <button
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shrink-0"
          >
            <Plus className="w-4 h-4" />
            New lecture
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[#787774]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading lectures…
        </div>
      ) : lectures.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-sm text-[#37352F] font-medium">No lectures yet</p>
          <p className="text-xs text-[#787774] max-w-sm">
            {isOwner
              ? 'Create a lecture, then attach a recording, notes, and a summary.'
              : 'The course owner has not added any lectures yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {lectures.map(lec => (
            <button
              key={lec.id}
              onClick={() => setActiveId(lec.id)}
              className="text-start bg-white border border-[#E8E8E6] rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all duration-150"
            >
              <h3 className="text-sm font-semibold text-[#37352F] line-clamp-2">{lec.title}</h3>
              {lec.lecture_date && (
                <p className="text-xs text-[#787774] mt-1 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  {new Date(lec.lecture_date).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </p>
              )}
              {(() => {
                const firstLecturer = lec.lecturer_summaries?.[0]?.content;
                const preview = lec.unified_summary || firstLecturer;
                return preview ? (
                  <p className="text-xs text-[#787774] mt-2 line-clamp-3 leading-relaxed">{preview}</p>
                ) : null;
              })()}
              <div className="mt-3 flex items-center gap-3 text-[10px] text-[#787774] flex-wrap">
                <span className={`flex items-center gap-1 ${lec.unified_summary ? 'text-indigo-600' : 'text-[#C4C4C4]'}`}>
                  <BookOpen className="w-3 h-3" /> מאוחד
                </span>
                <span className={`flex items-center gap-1 ${(lec.lecturer_summaries?.length ?? 0) > 0 ? 'text-indigo-600' : 'text-[#C4C4C4]'}`}>
                  <BookOpen className="w-3 h-3" /> מרצה ({lec.lecturer_summaries?.length ?? 0})
                </span>
                <span className={`flex items-center gap-1 ${(lec.recordings?.length ?? 0) > 0 ? 'text-indigo-600' : 'text-[#C4C4C4]'}`}>
                  <Mic className="w-3 h-3" /> הקלטות ({lec.recordings?.length ?? 0})
                </span>
                <span className={`flex items-center gap-1 ${(lec.notes?.length ?? 0) > 0 ? 'text-indigo-600' : 'text-[#C4C4C4]'}`}>
                  {lec.notes?.[0]?.doc_type === 'IMAGE' ? <Image className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                  הערות ({lec.notes?.length ?? 0})
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <LectureModal
        isOpen={modalOpen}
        editing={editing ? { id: editing.id, title: editing.title, lecture_date: editing.lecture_date } : null}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={handleSave}
      />
    </div>
  );
}
