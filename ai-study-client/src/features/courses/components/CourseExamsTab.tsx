import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, Loader2, Calendar, GraduationCap, TrendingUp,
  ChevronRight, AlertCircle,
} from 'lucide-react';
import { api } from '../../../services/api';
import type { CourseLecturer, ExamCard, ExamDetail } from '../../../types/course';
import ExamStatsHeader from './ExamStatsHeader';
import ExamCreateModal from './ExamCreateModal';
import ExamDetailView from './ExamDetailView';

interface CourseExamsTabProps {
  courseId:  number;
  isOwner:   boolean;
}

function difficultyBadge(score: number | null) {
  if (score == null) return { label: '—',      cls: 'text-[#C4C4C4] bg-[#F7F7F5] border-[#E8E8E6]' };
  if (score < 0.33)  return { label: 'Easy',   cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  if (score < 0.66)  return { label: 'Medium', cls: 'text-amber-700   bg-amber-50   border-amber-200' };
  return                    { label: 'Hard',   cls: 'text-red-700     bg-red-50     border-red-200' };
}

export default function CourseExamsTab({ courseId, isOwner }: CourseExamsTabProps) {
  const [exams, setExams]           = useState<ExamCard[]>([]);
  const [lecturers, setLecturers]   = useState<CourseLecturer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeExamId, setActiveExamId] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      // Pull exams and the course syllabus in parallel — syllabus only used
      // to populate the lecturer chips in the upload modal. Errors on the
      // syllabus call are non-fatal (an empty lecturer list is fine).
      const [examsRes, syllabusRes] = await Promise.allSettled([
        api.listCourseExams(courseId),
        api.getCourseSyllabus(courseId),
      ]);
      if (examsRes.status === 'fulfilled') {
        setExams(examsRes.value.data);
        setError(null);
      } else {
        console.error('[CourseExamsTab] exam fetch failed', examsRes.reason);
        setError('Could not load exams.');
      }
      if (syllabusRes.status === 'fulfilled') {
        setLecturers(syllabusRes.value.data?.lecturers ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [courseId]);

  // When an exam is created, drop the card into the list (the response is a
  // full ExamDetail; we just keep the card-shaped fields).
  const handleCreated = (created: ExamDetail) => {
    setExams(prev => {
      const card: ExamCard = {
        id:                   created.id,
        title:                created.title,
        year:                 created.year,
        semester:             created.semester,
        has_solutions:        created.has_solutions,
        aggregate_difficulty: created.aggregate_difficulty,
        question_count:       created.question_count,
        topics:               created.topics,
        lecturers:            created.lecturers,
        processed_at:         created.processed_at,
        created_at:           created.created_at,
      };
      return [card, ...prev];
    });
  };

  const handleDeleted = (examId: number) => {
    setExams(prev => prev.filter(e => e.id !== examId));
    setActiveExamId(null);
  };

  const activeCard = useMemo(
    () => exams.find(e => e.id === activeExamId) ?? null,
    [exams, activeExamId],
  );

  // ── Detail view ─────────────────────────────────────────────────────────
  if (activeCard) {
    return (
      <ExamDetailView
        examCard={activeCard}
        isOwner={isOwner}
        onBack={() => setActiveExamId(null)}
        onDeleted={handleDeleted}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Top row: stats (only when there's data) + Add exam button */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">
          Past papers ({exams.length})
        </h3>
        {isOwner && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
          >
            <Plus className="w-4 h-4" />
            Upload exam
          </button>
        )}
      </div>

      <ExamStatsHeader exams={exams} />

      {/* Table / loading / empty */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-[#787774]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading exams…</span>
        </div>
      ) : exams.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E8E8E6] rounded-xl py-12 px-6 flex flex-col items-center gap-3 text-[#787774]">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-sm">No past exams uploaded yet.</p>
          {isOwner && (
            <>
              <p className="text-xs text-[#C4C4C4] max-w-sm text-center leading-relaxed">
                Upload a PDF and the AI breaks it into questions, tags topics + question types,
                and computes a relative-difficulty score against the rest of this course.
              </p>
              <button
                onClick={() => setCreateOpen(true)}
                className="mt-1 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                <Plus className="w-4 h-4" />
                Upload your first exam
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white border border-[#E8E8E6] rounded-xl overflow-hidden">
          {/* Table header (desktop). On narrow screens the tr renders as cards. */}
          <div className="hidden md:grid md:grid-cols-12 gap-3 px-4 py-2.5 border-b border-[#E8E8E6] bg-[#F7F7F5]/60 text-[10px] font-semibold uppercase tracking-widest text-[#787774]">
            <span className="md:col-span-4">Title</span>
            <span className="md:col-span-2">Period</span>
            <span className="md:col-span-2">Lecturers</span>
            <span className="md:col-span-1 text-center">Qs</span>
            <span className="md:col-span-2">Difficulty</span>
            <span className="md:col-span-1"></span>
          </div>

          {exams.map(exam => {
            const b = difficultyBadge(exam.aggregate_difficulty);
            return (
              <button
                key={exam.id}
                onClick={() => setActiveExamId(exam.id)}
                className="w-full text-start grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 px-4 py-3 border-b border-[#E8E8E6] last:border-0 hover:bg-[#F7F7F5] transition-colors duration-150"
              >
                {/* Title + topics */}
                <div className="md:col-span-4 min-w-0">
                  <p className="text-sm font-medium text-[#37352F] truncate">{exam.title}</p>
                  {exam.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {exam.topics.slice(0, 3).map(t => (
                        <span key={t.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                          {t.name}
                        </span>
                      ))}
                      {exam.topics.length > 3 && (
                        <span className="text-[10px] text-[#C4C4C4]">+{exam.topics.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Year + semester */}
                <div className="md:col-span-2 flex items-center gap-1.5 text-xs text-[#787774] min-w-0">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {[exam.semester, exam.year].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>

                {/* Lecturers */}
                <div className="md:col-span-2 flex items-center gap-1.5 text-xs text-[#787774] min-w-0">
                  <GraduationCap className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {exam.lecturers.length === 0
                      ? '—'
                      : exam.lecturers.map(l => l.name).join(', ')}
                  </span>
                </div>

                {/* Question count */}
                <div className="md:col-span-1 text-xs text-[#37352F] md:text-center">
                  {exam.question_count}
                </div>

                {/* Difficulty */}
                <div className="md:col-span-2 flex items-center">
                  <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${b.cls}`}>
                    <TrendingUp className="w-3 h-3" />
                    {b.label}
                    {exam.aggregate_difficulty != null && ` · ${(exam.aggregate_difficulty * 100).toFixed(0)}%`}
                  </span>
                </div>

                {/* Chevron */}
                <div className="md:col-span-1 flex items-center justify-end text-[#C4C4C4]">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <ExamCreateModal
        isOpen={createOpen}
        courseId={courseId}
        lecturers={lecturers}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
