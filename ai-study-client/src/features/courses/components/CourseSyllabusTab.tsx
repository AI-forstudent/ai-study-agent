import { useEffect, useRef, useState } from 'react';
import {
  FileText, Upload, Loader2, BookOpen, Users, GraduationCap,
  ListChecks, Trash2, AlertCircle, Sparkles, Tag,
} from 'lucide-react';
import { api } from '../../../services/api';
import { ACCEPTED_FILE_TYPES } from '../../../utils/fileIcons';
import type { CourseSyllabus } from '../../../types/course';

interface CourseSyllabusTabProps {
  courseId: number;
  isOwner: boolean;
}

export default function CourseSyllabusTab({ courseId, isOwner }: CourseSyllabusTabProps) {
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const [syllabus, setSyllabus]       = useState<CourseSyllabus | null>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const res = await api.getCourseSyllabus(courseId);
      setSyllabus(res.data);
    } catch (err) {
      console.error('[CourseSyllabusTab] fetch failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [courseId]);

  // ── Upload + attach in one go ─────────────────────────────────────────────
  // The user picks a PDF / DOCX. We push it through the existing /documents
  // upload endpoint to land it in their library (CAS dedup applies), THEN
  // attach the resulting user_document_id as the course's syllabus, which
  // triggers the Gemini extraction on the backend.
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setError(null);
    try {
      // 1. Upload the document into the user's library
      let userDocumentId: number;
      try {
        const upload = await api.uploadDocument(file, false);
        userDocumentId = upload.data.id;
      } catch (uploadErr: any) {
        // 409 = doc already in library; we can't recover the existing id
        // from the error response without a separate lookup, so explain it.
        if (uploadErr?.response?.status === 409) {
          throw new Error(
            "You already have this file in your library. Open it from My Library and use the 'Set as syllabus' menu option (TODO).",
          );
        }
        throw new Error('Upload failed.');
      }

      // 2. Attach as syllabus (triggers Gemini extraction server-side)
      const res = await api.attachCourseSyllabus(courseId, userDocumentId);
      setSyllabus(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Failed to attach syllabus.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDetach = async () => {
    if (!confirm('Remove the syllabus from this course? Topics extracted from it will stay.')) return;
    try {
      const res = await api.detachCourseSyllabus(courseId);
      setSyllabus(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to detach syllabus.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-[#787774]">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading syllabus…</span>
      </div>
    );
  }

  const hasSyllabus = !!syllabus?.user_document_id && !!syllabus.extracted;
  const ext = syllabus?.extracted ?? null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── No syllabus yet ─────────────────────────────────────────────── */}
      {!hasSyllabus ? (
        <div className="bg-white border border-dashed border-[#E8E8E6] rounded-xl py-12 px-6 flex flex-col items-center gap-3 text-[#787774]">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-sm">No syllabus attached to this course yet.</p>
          {isOwner ? (
            <>
              <p className="text-xs text-[#C4C4C4] max-w-sm text-center leading-relaxed">
                Upload your course syllabus (PDF or Word). The AI extracts topics, books,
                lecturers, and prerequisites — those become the context for every
                AI Teacher chat opened in this course.
              </p>
              <label
                className={`mt-2 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer ${
                  isUploading ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isUploading ? 'Extracting…' : 'Upload Syllabus'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  className="hidden"
                  onChange={handleFile}
                  disabled={isUploading}
                />
              </label>
            </>
          ) : (
            <p className="text-xs text-[#C4C4C4] max-w-sm text-center">
              Only the course owner can attach a syllabus.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* ── Header card ────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-3 bg-white border border-[#E8E8E6] rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#37352F]">Syllabus extracted</p>
                <p className="text-xs text-[#787774] mt-0.5">
                  This information is injected into every chat opened with course context.
                </p>
                {ext?.language && (
                  <p className="text-[10px] text-[#C4C4C4] mt-1">
                    Detected language: {ext.language}
                  </p>
                )}
              </div>
            </div>
            {isOwner && (
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#787774] border border-[#E8E8E6] rounded-md hover:bg-[#F7F7F5] cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Replace
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    className="hidden"
                    onChange={handleFile}
                    disabled={isUploading}
                  />
                </label>
                <button
                  onClick={handleDetach}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-100 rounded-md hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Detach
                </button>
              </div>
            )}
          </div>

          {/* ── Topics ─────────────────────────────────────────────────── */}
          <Section title="Topics" icon={Tag} count={ext?.topics?.length ?? 0}>
            {ext?.topics && ext.topics.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {ext.topics.map((t, i) => (
                  <span key={`${t}-${i}`} className="text-xs font-medium px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                    {t}
                  </span>
                ))}
              </div>
            ) : <Empty />}
          </Section>

          {/* ── Lecturers ───────────────────────────────────────────────── */}
          <Section title="Teaching staff" icon={Users} count={syllabus?.lecturers.length ?? 0}>
            {syllabus && syllabus.lecturers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {syllabus.lecturers.map(lec => (
                  <span key={lec.id} className="text-xs font-medium px-2 py-1 rounded-md bg-violet-50 text-violet-700 border border-violet-200">
                    {lec.name}
                    {lec.role !== 'lecturer' && (
                      <span className="ms-1 text-[10px] text-violet-500">· {lec.role}</span>
                    )}
                  </span>
                ))}
              </div>
            ) : <Empty />}
          </Section>

          {/* ── Reading list ─────────────────────────────────────────────── */}
          <Section title="Reading list" icon={BookOpen} count={ext?.books?.length ?? 0}>
            {ext?.books && ext.books.length > 0 ? (
              <ul className="space-y-1.5">
                {ext.books.map((b, i) => (
                  <li key={`${b}-${i}`} className="text-xs text-[#37352F] flex items-start gap-2">
                    <BookOpen className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                    {b}
                  </li>
                ))}
              </ul>
            ) : <Empty />}
          </Section>

          {/* ── Prerequisites ────────────────────────────────────────────── */}
          <Section title="Prerequisites" icon={GraduationCap} count={ext?.prerequisites?.length ?? 0}>
            {ext?.prerequisites && ext.prerequisites.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {ext.prerequisites.map((p, i) => (
                  <span key={`${p}-${i}`} className="text-xs font-medium px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {p}
                  </span>
                ))}
              </div>
            ) : <Empty />}
          </Section>

          {/* ── Grading + meta ───────────────────────────────────────────── */}
          {ext?.grading_policy && (
            <Section title="Grading policy" icon={ListChecks}>
              <p className="text-xs text-[#37352F] leading-relaxed">{ext.grading_policy}</p>
            </Section>
          )}

          {ext?.weekly_breakdown && ext.weekly_breakdown.length > 0 && (
            <Section title="Weekly schedule" icon={ListChecks} count={ext.weekly_breakdown.length}>
              <table className="w-full text-xs">
                <tbody>
                  {ext.weekly_breakdown.map(w => (
                    <tr key={w.week} className="border-b border-[#E8E8E6] last:border-0">
                      <td className="py-1.5 pe-3 text-[#787774] w-16">Week {w.week}</td>
                      <td className="py-1.5 text-[#37352F]">{w.topic}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon:  React.ElementType;
  count?: number;
  children: React.ReactNode;
}

function Section({ title, icon: Icon, count, children }: SectionProps) {
  return (
    <section className="bg-white border border-[#E8E8E6] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-3.5 h-3.5 text-[#787774]" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">{title}</h3>
        {typeof count === 'number' && (
          <span className="text-[10px] text-[#C4C4C4] font-normal">({count})</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-xs text-[#C4C4C4] italic">Nothing extracted for this section.</p>;
}
