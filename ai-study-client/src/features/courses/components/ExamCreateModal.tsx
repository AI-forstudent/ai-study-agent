import { useEffect, useRef, useState } from 'react';
import {
  X, Upload, Save, Loader2, AlertCircle, FileText, GraduationCap, Sparkles,
} from 'lucide-react';
import { api } from '../../../services/api';
import { ACCEPTED_FILE_TYPES } from '../../../utils/fileIcons';
import type { CourseLecturer, ExamDetail } from '../../../types/course';

interface ExamCreateModalProps {
  isOpen:    boolean;
  courseId:  number;
  /** All lecturers attached to this course — picked from the syllabus extraction
   *  or added manually. The user can tag the exam with any subset. */
  lecturers: CourseLecturer[];
  onClose:   () => void;
  /** Fires after a successful upload; the created ExamDetail is the response
   *  from POST /courses/{id}/exams (already includes extracted questions). */
  onCreated: (exam: ExamDetail) => void;
}

// Three independent metadata axes per T-020. Each dropdown carries an
// empty option labelled "Auto-detect" — when the user leaves it on
// "Auto-detect", the backend's AI extraction fills the field. When the
// user picks a value, that explicit choice wins.
type SelectOption = { value: string; label: string };

const SEMESTER_OPTIONS: SelectOption[] = [
  { value: '',       label: 'Auto-detect' },
  { value: 'Fall',   label: 'Fall' },
  { value: 'Spring', label: 'Spring' },
  { value: 'Summer', label: 'Summer' },
  { value: 'Other',  label: 'Other' },
];

const MOED_OPTIONS = [
  { value: '',        label: 'Auto-detect' },
  { value: 'A',       label: 'Moed A' },
  { value: 'B',       label: 'Moed B' },
  { value: 'C',       label: 'Moed C' },
  { value: 'D',       label: 'Moed D' },
  { value: 'Special', label: 'Special / Meyuhad' },
];

const EXAM_TYPE_OPTIONS = [
  { value: '',          label: 'Auto-detect' },
  { value: 'midterm',   label: 'Midterm' },
  { value: 'final',     label: 'Final' },
  { value: 'quiz',      label: 'Quiz' },
  { value: 'practice',  label: 'Practice' },
  { value: 'other',     label: 'Other' },
];

export default function ExamCreateModal({
  isOpen, courseId, lecturers, onClose, onCreated,
}: ExamCreateModalProps) {
  // ── Form state ──────────────────────────────────────────────────────────
  // All three metadata fields default to '' ("Auto-detect") so the AI fills
  // them unless the user explicitly picks a value. Title still defaults to
  // the filename so we don't ship empty cards.
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const [file, setFile]               = useState<File | null>(null);
  const [title, setTitle]             = useState('');
  const [year, setYear]               = useState<string>('');
  const [semester, setSemester]       = useState<string>('');   // '' → auto-detect
  const [moed, setMoed]               = useState<string>('');   // '' → auto-detect
  const [examType, setExamType]       = useState<string>('');   // '' → auto-detect
  const [hasSolutions, setHasSolutions] = useState(false);
  const [lecturerIds, setLecturerIds] = useState<Set<number>>(new Set());

  // ── Step state ──────────────────────────────────────────────────────────
  // 'queueing' = creating the exam shell on the backend (fast — extract_text
  // + a DB insert; the AI pipeline runs in a BackgroundTask afterwards and
  // is reflected via `processing_status` on the table row).
  const [phase, setPhase]   = useState<'idle' | 'uploading' | 'queueing'>('idle');
  const [error, setError]   = useState<string | null>(null);
  // When upload succeeded but the processing pipeline failed, we cache the
  // userDocumentId so the retry button can skip re-uploading (which would
  // otherwise hit the CAS 409 dedup) and just re-run the AI pipeline.
  const [uploadedDocId, setUploadedDocId] = useState<number | null>(null);

  // Reset on open + close on Esc.
  useEffect(() => {
    if (!isOpen) return;
    setFile(null);
    setTitle('');
    setYear('');
    setSemester('');
    setMoed('');
    setExamType('');
    setHasSolutions(false);
    setLecturerIds(new Set());
    setPhase('idle');
    setError(null);
    setUploadedDocId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase === 'idle') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose, phase]);

  if (!isOpen) return null;

  const toggleLecturer = (id: number) => {
    setLecturerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    // Auto-suggest a title from the filename if the field is empty
    if (!title) {
      setTitle(f.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const canSubmit = (!!file || uploadedDocId !== null) && !!title.trim() && phase === 'idle';

  const handleSubmit = async () => {
    if ((!file && uploadedDocId === null) || !title.trim()) {
      setError('Pick a file and give the exam a title.');
      return;
    }
    setError(null);

    // ── Step 1: upload the file (skipped on a retry where the upload
    //            already succeeded last time — `uploadedDocId` is cached). ─
    let userDocumentId = uploadedDocId;
    if (userDocumentId === null) {
      setPhase('uploading');
      try {
        const upload = await api.uploadDocument(file!, false);
        userDocumentId = upload.data.id;
        setUploadedDocId(userDocumentId);
      } catch (err: any) {
        if (err?.response?.status === 409) {
          setError(
            "You already have this exam file in your library. Delete it from My Library first, " +
            "or pick a different version of the PDF.",
          );
        } else {
          setError(err?.response?.data?.detail ?? 'Upload failed.');
        }
        setPhase('idle');
        return;
      }
    }

    // ── Step 2: queue the exam for AI processing ────────────────────────
    // Backend now returns 202 once the row is committed; the heavy AI
    // pipeline (extract → tag × N → calibrate) runs in a BackgroundTask
    // and the user watches `processing_status` flip on the table row.
    setPhase('queueing');
    try {
      const yearInt = year.trim() ? parseInt(year, 10) : null;
      const res = await api.createCourseExam(courseId, {
        user_document_id: userDocumentId!,
        title:            title.trim(),
        year:             Number.isFinite(yearInt) ? yearInt : null,
        // Empty string from the "Auto-detect" option → null, lets the
        // backend AI fill the field. Picked value → wins over AI.
        semester:         semester || null,
        moed:             moed || null,
        exam_type:        examType || null,
        has_solutions:    hasSolutions,
        lecturer_ids:     [...lecturerIds],
      });
      onCreated(res.data);
      onClose();
    } catch (err: any) {
      // Validation / file-read errors. The actual AI failures don't reach
      // here anymore (they fail in the BackgroundTask and the row just
      // ends up with status='failed' in the table).
      setError(err?.response?.data?.detail ?? 'Could not queue this exam for processing.');
      setPhase('idle');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => phase === 'idle' && onClose()}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-[#E8E8E6] w-full max-w-lg flex flex-col"
        dir="ltr"
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8E8E6]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-[#37352F]">Upload past exam</span>
          </div>
          <button
            onClick={onClose}
            disabled={phase !== 'idle'}
            className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] disabled:opacity-50 transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{error}</p>
                {uploadedDocId !== null && (
                  <p className="mt-1 text-[11px] text-red-500">
                    Your file is already uploaded — clicking "Upload &amp; Process" will retry just the AI extraction.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* File picker */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Exam file</p>
            <label
              className={`flex items-center gap-3 px-3 py-3 border border-dashed rounded-lg cursor-pointer transition-colors duration-150 ${
                file
                  ? 'border-indigo-300 bg-indigo-50/40'
                  : 'border-[#E8E8E6] hover:bg-[#F7F7F5]'
              } ${phase !== 'idle' ? 'pointer-events-none opacity-60' : ''}`}
            >
              <Upload className="w-4 h-4 text-[#787774] shrink-0" />
              <div className="flex-1 min-w-0">
                {file ? (
                  <>
                    <p className="text-sm text-[#37352F] truncate">{file.name}</p>
                    <p className="text-[10px] text-[#787774]">{(file.size / 1024).toFixed(0)} KB · click to replace</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[#787774]">Pick a PDF / DOCX</p>
                    <p className="text-[10px] text-[#C4C4C4]">Past papers from any year — solutions optional.</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={handleFile}
              />
            </label>
          </div>

          {/* Title */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Title</p>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Calculus 1 — Moed A 2024"
              disabled={phase !== 'idle'}
              className="w-full h-9 px-3 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:opacity-60 transition-colors duration-150"
            />
          </div>

          {/* Year / Semester / Moed / Exam type — three independent metadata
               axes per spec; never concatenated. All optional — leaving any
               field on "Auto-detect" lets the AI fill it from the PDF. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Year</p>
              <input
                type="number"
                value={year}
                onChange={e => setYear(e.target.value)}
                disabled={phase !== 'idle'}
                placeholder="auto"
                className="w-full h-9 px-3 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:opacity-60 placeholder:text-[#C4C4C4]"
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Semester</p>
              <select
                value={semester}
                onChange={e => setSemester(e.target.value)}
                disabled={phase !== 'idle'}
                className="w-full h-9 px-2 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:opacity-60"
              >
                {SEMESTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Moed</p>
              <select
                value={moed}
                onChange={e => setMoed(e.target.value)}
                disabled={phase !== 'idle'}
                className="w-full h-9 px-2 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:opacity-60"
              >
                {MOED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Type</p>
              <select
                value={examType}
                onChange={e => setExamType(e.target.value)}
                disabled={phase !== 'idle'}
                className="w-full h-9 px-2 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:opacity-60"
              >
                {EXAM_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-[#C4C4C4] -mt-2">
            Leave any field on "Auto-detect" and the AI will infer it from the PDF.
          </p>

          {/* Has solutions */}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasSolutions}
              onChange={e => setHasSolutions(e.target.checked)}
              disabled={phase !== 'idle'}
              className="mt-0.5 w-4 h-4 rounded border-[#E8E8E6] text-indigo-600 focus:ring-indigo-500/20"
            />
            <div className="flex-1">
              <p className="text-sm text-[#37352F]">This file already includes solutions</p>
              <p className="text-[10px] text-[#787774] leading-relaxed">
                If unchecked, the AI will generate reference solutions from the questions.
                Either way, every question gets a solution stored — used later for grading
                "Take exam" submissions.
              </p>
            </div>
          </label>

          {/* Lecturers */}
          {lecturers.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">
                <GraduationCap className="w-3 h-3 inline me-1" />
                Lecturers (optional)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {lecturers.map(lec => {
                  const active = lecturerIds.has(lec.id);
                  return (
                    <button
                      key={lec.id}
                      type="button"
                      onClick={() => toggleLecturer(lec.id)}
                      disabled={phase !== 'idle'}
                      className={`text-xs font-medium px-2 py-1 rounded-md border transition-colors duration-150 ${
                        active
                          ? 'bg-violet-50 text-violet-700 border-violet-300'
                          : 'bg-white text-[#787774] border-[#E8E8E6] hover:bg-[#F7F7F5]'
                      } disabled:opacity-60`}
                    >
                      {lec.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-[#E8E8E6] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={phase !== 'idle'}
            className="px-3 py-1.5 text-sm font-medium text-[#787774] hover:bg-[#F7F7F5] rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors duration-150"
          >
            {phase === 'uploading' ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
            ) : phase === 'queueing' ? (
              <><Sparkles className="w-3.5 h-3.5 animate-pulse" /> Queueing…</>
            ) : (
              <><Save className="w-3.5 h-3.5" /> Upload &amp; Process</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
