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

const SEMESTER_OPTIONS = ['Fall', 'Spring', 'Summer', 'Moed A', 'Moed B', 'Moed C', 'Other'];

export default function ExamCreateModal({
  isOpen, courseId, lecturers, onClose, onCreated,
}: ExamCreateModalProps) {
  // ── Form state ──────────────────────────────────────────────────────────
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const [file, setFile]               = useState<File | null>(null);
  const [title, setTitle]             = useState('');
  const [year, setYear]               = useState<string>(String(new Date().getFullYear()));
  const [semester, setSemester]       = useState<string>('Fall');
  const [hasSolutions, setHasSolutions] = useState(false);
  const [lecturerIds, setLecturerIds] = useState<Set<number>>(new Set());

  // ── Step state ──────────────────────────────────────────────────────────
  const [phase, setPhase]   = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [error, setError]   = useState<string | null>(null);

  // Reset on open + close on Esc.
  useEffect(() => {
    if (!isOpen) return;
    setFile(null);
    setTitle('');
    setYear(String(new Date().getFullYear()));
    setSemester('Fall');
    setHasSolutions(false);
    setLecturerIds(new Set());
    setPhase('idle');
    setError(null);
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

  const canSubmit = !!file && !!title.trim() && phase === 'idle';

  const handleSubmit = async () => {
    if (!file || !title.trim()) {
      setError('Pick a file and give the exam a title.');
      return;
    }
    setError(null);

    // ── Step 1: upload the file into the user's library ────────────────
    setPhase('uploading');
    let userDocumentId: number;
    try {
      const upload = await api.uploadDocument(file, false);
      userDocumentId = upload.data.id;
    } catch (err: any) {
      // 409 = same SHA already exists in this user's library; we don't have
      // its id from the error response, so guide the user.
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

    // ── Step 2: attach as exam → triggers extraction + tagging pipeline ─
    setPhase('processing');
    try {
      const yearInt = year.trim() ? parseInt(year, 10) : null;
      const res = await api.createCourseExam(courseId, {
        user_document_id: userDocumentId,
        title:            title.trim(),
        year:             Number.isFinite(yearInt) ? yearInt : null,
        semester:         semester || null,
        has_solutions:    hasSolutions,
        lecturer_ids:     [...lecturerIds],
      });
      onCreated(res.data);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Could not process the exam — check the file and try again.');
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
              <span>{error}</span>
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

          {/* Year + semester (side-by-side) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Year</p>
              <input
                type="number"
                value={year}
                onChange={e => setYear(e.target.value)}
                disabled={phase !== 'idle'}
                placeholder="2024"
                className="w-full h-9 px-3 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:opacity-60"
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
                {SEMESTER_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

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
            ) : phase === 'processing' ? (
              <><Sparkles className="w-3.5 h-3.5 animate-pulse" /> AI extracting…</>
            ) : (
              <><Save className="w-3.5 h-3.5" /> Upload &amp; Process</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
