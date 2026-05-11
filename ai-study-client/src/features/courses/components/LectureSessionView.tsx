import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Calendar, Mic, FileText, Trash2,
  Loader2, Save, Pencil, AlertTriangle, Download, Sparkles, RefreshCw,
  X, Plus, ChevronDown, ChevronRight, Upload, MoreHorizontal, BookOpen,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

import { api } from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import { LECTURE_RECORDING_TYPES, LECTURE_NOTES_TYPES } from '../../../utils/fileIcons';

// ── Types ────────────────────────────────────────────────────────────────────

/** GET /api/v1/lectures/{id} response (F-035 PDF-backed summaries). */
export interface Lecture {
  id:                            number;
  course_id:                     number;
  title:                         string;
  lecture_date:                  string | null;
  unified_summary:               string | null;
  unified_summary_processing:    boolean;
  unified_summary_error:         string | null;
  unified_summary_generated_at:  string | null;
  // F-036: rendered PDF of the unified summary (opens in MainWorkspace).
  unified_summary_document_id:   number | null;
  unified_summary_file_path:     string | null;
  unified_summary_doc_type:      string | null;
  lecturer_summaries:            LectureLecturerSummary[];
  student_summaries:             LectureStudentSummary[];
  recordings:                    LectureAttachment[];
  notes:                         LectureAttachment[];
  created_at:                    string | null;
  updated_at:                    string | null;
}

export interface LectureLecturerSummary {
  id:               number;
  lecture_id:       number;
  lecturer_id:      number | null;
  lecturer_name:    string | null;
  user_document_id: number | null;
  file_path:        string | null;
  doc_type:         string;
  title:            string;
  created_at:       string | null;
  updated_at:       string | null;
}

export interface LectureStudentSummary {
  id:               number;
  lecture_id:       number;
  user_document_id: number | null;
  file_path:        string | null;
  doc_type:         string;
  title:            string;
  created_at:       string | null;
  updated_at:       string | null;
}

export interface LectureAttachment {
  id:               number;
  lecture_id:       number;
  user_document_id: number | null;
  title:            string;
  file_path:        string | null;
  doc_type:         string;
  created_at:       string | null;
}

interface CourseLecturer {
  id:    number;
  name:  string;
  email: string | null;
  role:  string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const UPLOADS_BASE = (import.meta.env.VITE_AI_API_URL ?? '').replace(/\/$/, '');

// Summary uploads accept PDF + Word formats — the backend's LibreOffice
// pipeline converts Word into PDF on upload, so a single PdfViewer-style
// flow works for everything once it lands in CAS.
const LECTURE_SUMMARY_TYPES = '.pdf,.docx,.doc';

function attachmentUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const clean = filePath.replace(/^\/+/, '');
  return `${UPLOADS_BASE}/${clean}`;
}

// ── Selection model ─────────────────────────────────────────────────────────

type Selection =
  | { kind: 'unified' }
  | { kind: 'lecturer'; id: number }
  | { kind: 'student'; id: number }
  | { kind: 'recording'; id: number }
  | { kind: 'note'; id: number };

function pickDefaultSelection(lec: Lecture): Selection {
  if (lec.unified_summary?.trim())   return { kind: 'unified' };
  if (lec.lecturer_summaries.length) return { kind: 'lecturer', id: lec.lecturer_summaries[0].id };
  if (lec.student_summaries.length)  return { kind: 'student',  id: lec.student_summaries[0].id };
  if (lec.recordings.length)         return { kind: 'recording', id: lec.recordings[0].id };
  if (lec.notes.length)              return { kind: 'note',      id: lec.notes[0].id };
  return { kind: 'unified' };
}

// ── Markdown renderer (for unified summary) ─────────────────────────────────

const summaryMdComponents = {
  p:      ({ node, ...props }: any) => <p dir="auto" className="leading-relaxed my-3" {...props} />,
  li:     ({ node, ...props }: any) => <li dir="auto" {...props} />,
  h1:     ({ node, ...props }: any) => <h1 dir="auto" className="text-2xl font-semibold mt-6 mb-3" {...props} />,
  h2:     ({ node, ...props }: any) => <h2 dir="auto" className="text-xl font-semibold mt-5 mb-2" {...props} />,
  h3:     ({ node, ...props }: any) => <h3 dir="auto" className="text-lg font-semibold mt-4 mb-2" {...props} />,
  h4:     ({ node, ...props }: any) => <h4 dir="auto" className="text-base font-semibold mt-3 mb-1.5" {...props} />,
  strong: ({ node, ...props }: any) => <strong className="text-[#37352F] font-semibold" {...props} />,
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-indigo-300 bg-indigo-50/50 pl-4 py-2 my-3 italic text-[#37352F]" {...props} />
  ),
};

// ══════════════════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════════════════

interface LectureSessionViewProps {
  lecture:  Lecture;
  isOwner:  boolean;
  onBack:   () => void;
  onChange: (updated: Lecture) => void;
  onDelete: () => Promise<void>;
  onRename: () => void;
}

export default function LectureSessionView({
  lecture, isOwner, onBack, onChange, onDelete, onRename,
}: LectureSessionViewProps) {
  // ── Selection ────────────────────────────────────────────────────────────
  const [selection, setSelection] = useState<Selection>(() => pickDefaultSelection(lecture));
  const lectureIdRef = useRef(lecture.id);
  useEffect(() => {
    if (lectureIdRef.current !== lecture.id) {
      lectureIdRef.current = lecture.id;
      setSelection(pickDefaultSelection(lecture));
    }
  }, [lecture]);

  // ── Course lecturers (for the picker) ────────────────────────────────────
  const [courseLecturers, setCourseLecturers] = useState<CourseLecturer[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.listCourseLecturers(lecture.course_id).then(res => {
      if (cancelled) return;
      setCourseLecturers(res.data ?? []);
    }).catch(() => { /* not critical */ });
    return () => { cancelled = true; };
  }, [lecture.course_id]);

  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);

  // ── Modals ───────────────────────────────────────────────────────────────
  const [lecturerModal, setLecturerModal] = useState<{ editing: LectureLecturerSummary | null } | null>(null);
  const [studentModal,  setStudentModal]  = useState<{ editing: LectureStudentSummary | null }  | null>(null);
  const [generatePickerOpen, setGeneratePickerOpen] = useState(false);
  const recordingInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef     = useRef<HTMLInputElement>(null);

  // ── Unified-summary polling ─────────────────────────────────────────────
  useEffect(() => {
    if (!lecture.unified_summary_processing) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.getLecture(lecture.id);
        if (!cancelled) onChange(res.data);
      } catch { /* transient — next tick retries */ }
    };
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture.id, lecture.unified_summary_processing]);

  // ── In-session app-sidebar collapse ─────────────────────────────────────
  const setInSession = useAppStore(s => s.setInSession);
  useEffect(() => {
    setInSession(true);
    return () => setInSession(false);
  }, [setInSession]);

  // ── Generate unified summary ────────────────────────────────────────────
  async function startGeneration(lecturerSummaryId: number | null) {
    setError(null);
    try {
      const res = await api.generateLectureUnifiedSummary(lecture.id, lecturerSummaryId);
      onChange(res.data);
      setSelection({ kind: 'unified' });
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to start generation.');
    }
  }
  function handleGenerateClick() {
    if (!isOwner) return;
    if (lecture.lecturer_summaries.length === 0) {
      setError('צריך לפחות סיכום מרצה אחד לפני יצירת הסיכום המאוחד.');
      return;
    }
    if (lecture.lecturer_summaries.length === 1) {
      void startGeneration(lecture.lecturer_summaries[0].id);
      return;
    }
    setGeneratePickerOpen(true);
  }

  // ── Recording / note upload ─────────────────────────────────────────────
  const [uploading, setUploading] = useState<'recording' | 'note' | null>(null);
  async function handleFileUpload(file: File, kind: 'recording' | 'note') {
    setUploading(kind);
    setError(null);
    try {
      let userDocId: number;
      try {
        const upRes = await api.uploadDocument(file, false);
        userDocId = upRes.data.id;
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        const existing = err?.response?.status === 409 && typeof detail === 'object'
          ? detail?.existing_user_document_id : undefined;
        if (typeof existing === 'number') userDocId = existing;
        else throw err;
      }
      if (kind === 'recording') {
        const res = await api.createLectureRecording(lecture.id, {
          user_document_id: userDocId,
          title: file.name,
        });
        onChange({ ...lecture, recordings: [...lecture.recordings, res.data] });
        setSelection({ kind: 'recording', id: res.data.id });
      } else {
        const res = await api.createLectureNote(lecture.id, {
          user_document_id: userDocId,
          title: file.name,
        });
        onChange({ ...lecture, notes: [...lecture.notes, res.data] });
        setSelection({ kind: 'note', id: res.data.id });
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to upload file.');
    } finally {
      setUploading(null);
    }
  }

  // ── Selected item lookup ────────────────────────────────────────────────
  const selectedItem = useMemo(() => {
    if (selection.kind === 'lecturer')  return lecture.lecturer_summaries.find(s => s.id === selection.id) ?? null;
    if (selection.kind === 'student')   return lecture.student_summaries.find(s => s.id === selection.id)  ?? null;
    if (selection.kind === 'recording') return lecture.recordings.find(r => r.id === selection.id)         ?? null;
    if (selection.kind === 'note')      return lecture.notes.find(n => n.id === selection.id)              ?? null;
    return null;
  }, [selection, lecture]);

  // ── Delete handlers ─────────────────────────────────────────────────────
  async function deleteLecturerSummary(id: number) {
    try {
      await api.deleteLectureLecturerSummary(lecture.id, id);
      onChange({ ...lecture, lecturer_summaries: lecture.lecturer_summaries.filter(s => s.id !== id) });
      if (selection.kind === 'lecturer' && selection.id === id) setSelection(pickDefaultSelection(lecture));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to delete summary.');
    }
  }
  async function deleteStudentSummary(id: number) {
    try {
      await api.deleteLectureStudentSummary(lecture.id, id);
      onChange({ ...lecture, student_summaries: lecture.student_summaries.filter(s => s.id !== id) });
      if (selection.kind === 'student' && selection.id === id) setSelection(pickDefaultSelection(lecture));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to delete summary.');
    }
  }
  async function deleteRecording(id: number) {
    try {
      await api.deleteLectureRecording(lecture.id, id);
      onChange({ ...lecture, recordings: lecture.recordings.filter(r => r.id !== id) });
      if (selection.kind === 'recording' && selection.id === id) setSelection(pickDefaultSelection(lecture));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to delete recording.');
    }
  }
  async function deleteNote(id: number) {
    try {
      await api.deleteLectureNote(lecture.id, id);
      onChange({ ...lecture, notes: lecture.notes.filter(n => n.id !== id) });
      if (selection.kind === 'note' && selection.id === id) setSelection(pickDefaultSelection(lecture));
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to delete note.');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-row h-full min-h-0">
      {/* ── Main pane (PDF/markdown/audio/image) ──────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#FAFAF9] flex flex-col">
        {error && (
          <div className="m-3 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {selection.kind === 'unified' && (
            <UnifiedSummaryPane
              lecture={lecture}
              isOwner={isOwner}
              onGenerateClick={handleGenerateClick}
            />
          )}
          {selection.kind === 'lecturer' && selectedItem && (
            <DocViewerPane
              attachment={selectedItem as LectureLecturerSummary}
              caption={(selectedItem as LectureLecturerSummary).lecturer_name
                ? `סיכום מרצה · ${(selectedItem as LectureLecturerSummary).lecturer_name}`
                : 'סיכום מרצה'}
            />
          )}
          {selection.kind === 'student' && selectedItem && (
            <DocViewerPane
              attachment={selectedItem as LectureStudentSummary}
              caption="סיכום תלמיד"
            />
          )}
          {selection.kind === 'recording' && selectedItem && (
            <RecordingPane attachment={selectedItem as LectureAttachment} />
          )}
          {selection.kind === 'note' && selectedItem && (
            <DocViewerPane
              attachment={selectedItem as LectureAttachment}
              caption="הערות"
            />
          )}
          {selection.kind !== 'unified' && !selectedItem && <EmptyMainPane />}
        </div>
      </div>

      {/* ── Right sidebar: lecture title + accordion ──────────────────── */}
      <aside className="w-[300px] xl:w-[340px] shrink-0 border-s border-[#E8E8E6] bg-white flex flex-col min-h-0">
        {/* Header — back, title, overflow menu */}
        <div className="px-3 py-3 border-b border-[#E8E8E6] shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-xs text-[#787774] hover:text-[#37352F]"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Lectures
            </button>
            {isOwner && (
              <div className="relative">
                <button
                  onClick={() => setOverflowOpen(s => !s)}
                  className="p-1 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5]"
                  aria-label="More"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {overflowOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setOverflowOpen(false)} />
                    <div className="absolute end-0 mt-1 w-40 bg-white border border-[#E8E8E6] rounded-lg shadow-lg z-40 py-1">
                      <button
                        onClick={() => { setOverflowOpen(false); onRename(); }}
                        className="w-full text-start px-3 py-1.5 text-xs text-[#37352F] hover:bg-[#F7F7F5] flex items-center gap-1.5"
                      >
                        <Pencil className="w-3 h-3" /> Edit lecture
                      </button>
                      <button
                        onClick={() => { setOverflowOpen(false); setConfirmDelete(true); }}
                        className="w-full text-start px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3 h-3" /> Delete lecture
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <h2 dir="auto" className="text-sm font-semibold text-[#37352F] leading-snug">{lecture.title}</h2>
          {lecture.lecture_date && (
            <p className="text-[11px] text-[#787774] mt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(lecture.lecture_date).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
              })}
            </p>
          )}
        </div>

        <LectureAccordion
          lecture={lecture}
          isOwner={isOwner}
          selection={selection}
          setSelection={setSelection}
          onAddLecturerSummary={() => setLecturerModal({ editing: null })}
          onEditLecturerSummary={s => setLecturerModal({ editing: s })}
          onDeleteLecturerSummary={deleteLecturerSummary}
          onAddStudentSummary={() => setStudentModal({ editing: null })}
          onEditStudentSummary={s => setStudentModal({ editing: s })}
          onDeleteStudentSummary={deleteStudentSummary}
          onUploadRecording={() => recordingInputRef.current?.click()}
          onDeleteRecording={deleteRecording}
          onUploadNote={() => notesInputRef.current?.click()}
          onDeleteNote={deleteNote}
          uploading={uploading}
        />
      </aside>

      {/* Hidden file inputs */}
      <input
        ref={recordingInputRef}
        type="file"
        accept={LECTURE_RECORDING_TYPES}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFileUpload(f, 'recording');
        }}
      />
      <input
        ref={notesInputRef}
        type="file"
        accept={LECTURE_NOTES_TYPES}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFileUpload(f, 'note');
        }}
      />

      {/* Modals */}
      {lecturerModal && isOwner && (
        <SummaryUploadModal
          kind="lecturer"
          lectureId={lecture.id}
          editing={lecturerModal.editing}
          courseLecturers={courseLecturers}
          onClose={() => setLecturerModal(null)}
          onSaved={updated => {
            const exists = lecture.lecturer_summaries.some(s => s.id === updated.id);
            const next = exists
              ? lecture.lecturer_summaries.map(s => s.id === updated.id ? (updated as LectureLecturerSummary) : s)
              : [...lecture.lecturer_summaries, updated as LectureLecturerSummary];
            onChange({ ...lecture, lecturer_summaries: next });
            setLecturerModal(null);
            setSelection({ kind: 'lecturer', id: updated.id });
          }}
        />
      )}
      {studentModal && isOwner && (
        <SummaryUploadModal
          kind="student"
          lectureId={lecture.id}
          editing={studentModal.editing}
          courseLecturers={[]}
          onClose={() => setStudentModal(null)}
          onSaved={updated => {
            const exists = lecture.student_summaries.some(s => s.id === updated.id);
            const next = exists
              ? lecture.student_summaries.map(s => s.id === updated.id ? (updated as LectureStudentSummary) : s)
              : [...lecture.student_summaries, updated as LectureStudentSummary];
            onChange({ ...lecture, student_summaries: next });
            setStudentModal(null);
            setSelection({ kind: 'student', id: updated.id });
          }}
        />
      )}
      {generatePickerOpen && (
        <GeneratePicker
          summaries={lecture.lecturer_summaries}
          onCancel={() => setGeneratePickerOpen(false)}
          onPick={async id => {
            setGeneratePickerOpen(false);
            await startGeneration(id);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDeleteLecture
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => { await onDelete(); setConfirmDelete(false); }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Accordion sidebar
// ══════════════════════════════════════════════════════════════════════════

interface AccordionProps {
  lecture: Lecture;
  isOwner: boolean;
  selection: Selection;
  setSelection: (s: Selection) => void;
  onAddLecturerSummary: () => void;
  onEditLecturerSummary: (s: LectureLecturerSummary) => void;
  onDeleteLecturerSummary: (id: number) => Promise<void>;
  onAddStudentSummary: () => void;
  onEditStudentSummary: (s: LectureStudentSummary) => void;
  onDeleteStudentSummary: (id: number) => Promise<void>;
  onUploadRecording: () => void;
  onDeleteRecording: (id: number) => Promise<void>;
  onUploadNote: () => void;
  onDeleteNote: (id: number) => Promise<void>;
  uploading: 'recording' | 'note' | null;
}

function LectureAccordion({
  lecture, isOwner, selection, setSelection,
  onAddLecturerSummary, onEditLecturerSummary, onDeleteLecturerSummary,
  onAddStudentSummary,  onEditStudentSummary,  onDeleteStudentSummary,
  onUploadRecording, onDeleteRecording, onUploadNote, onDeleteNote, uploading,
}: AccordionProps) {
  const [open, setOpen] = useState({
    lecturer:  true,
    student:   lecture.student_summaries.length > 0,
    recording: lecture.recordings.length > 0,
    note:      lecture.notes.length > 0,
  });

  // Group lecturer summaries by lecturer (multiple lecturers / multiple versions).
  const lecturerGroups = useMemo(() => {
    const groups = new Map<number | 'none', { name: string; items: LectureLecturerSummary[] }>();
    for (const s of lecture.lecturer_summaries) {
      const key = s.lecturer_id ?? 'none';
      if (!groups.has(key)) {
        groups.set(key, { name: s.lecturer_name ?? 'ללא מרצה', items: [] });
      }
      groups.get(key)!.items.push(s);
    }
    return Array.from(groups.entries()).map(([k, v]) => ({ key: k, ...v }));
  }, [lecture.lecturer_summaries]);

  const initialExpandedLecturers = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const g of lecturerGroups) out[String(g.key)] = true;
    return out;
  }, [lecturerGroups]);
  const [expandedLecturers, setExpandedLecturers] = useState<Record<string, boolean>>(initialExpandedLecturers);
  useEffect(() => {
    setExpandedLecturers(prev => ({ ...initialExpandedLecturers, ...prev }));
  }, [initialExpandedLecturers]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-2 text-sm">
      <UnifiedRow
        lecture={lecture}
        active={selection.kind === 'unified'}
        onClick={() => setSelection({ kind: 'unified' })}
      />

      <SectionHeader
        icon={Pencil}
        label="סיכומי מרצה"
        count={lecture.lecturer_summaries.length}
        isOpen={open.lecturer}
        onToggle={() => setOpen(o => ({ ...o, lecturer: !o.lecturer }))}
        onAdd={isOwner ? onAddLecturerSummary : undefined}
      />
      {open.lecturer && (
        <div className="ps-2">
          {lecturerGroups.length === 0 ? (
            <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימים סיכומי מרצה.</p>
          ) : (
            lecturerGroups.map(g => (
              <div key={String(g.key)} className="mb-1">
                <button
                  onClick={() => setExpandedLecturers(p => ({ ...p, [String(g.key)]: !p[String(g.key)] }))}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-[#37352F] hover:bg-[#F7F7F5] rounded"
                >
                  {expandedLecturers[String(g.key)]
                    ? <ChevronDown  className="w-3 h-3 rtl:rotate-180 shrink-0" />
                    : <ChevronRight className="w-3 h-3 rtl:rotate-180 shrink-0" />}
                  <span className="truncate flex-1 text-start">{g.name}</span>
                  <span className="text-[#C4C4C4]">({g.items.length})</span>
                </button>
                {expandedLecturers[String(g.key)] && g.items.map(s => (
                  <ItemRow
                    key={s.id}
                    label={s.title}
                    active={selection.kind === 'lecturer' && selection.id === s.id}
                    onClick={() => setSelection({ kind: 'lecturer', id: s.id })}
                    onEdit={isOwner ? () => onEditLecturerSummary(s) : undefined}
                    onDelete={isOwner ? () => onDeleteLecturerSummary(s.id) : undefined}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      <SectionHeader
        icon={FileText}
        label="סיכומי תלמידים"
        count={lecture.student_summaries.length}
        isOpen={open.student}
        onToggle={() => setOpen(o => ({ ...o, student: !o.student }))}
        onAdd={isOwner ? onAddStudentSummary : undefined}
      />
      {open.student && (
        <div className="ps-2">
          {lecture.student_summaries.length === 0 ? (
            <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימים סיכומי תלמידים.</p>
          ) : (
            lecture.student_summaries.map(s => (
              <ItemRow
                key={s.id}
                label={s.title}
                active={selection.kind === 'student' && selection.id === s.id}
                onClick={() => setSelection({ kind: 'student', id: s.id })}
                onEdit={isOwner ? () => onEditStudentSummary(s) : undefined}
                onDelete={isOwner ? () => onDeleteStudentSummary(s.id) : undefined}
              />
            ))
          )}
        </div>
      )}

      <SectionHeader
        icon={Mic}
        label="הקלטות"
        count={lecture.recordings.length}
        isOpen={open.recording}
        onToggle={() => setOpen(o => ({ ...o, recording: !o.recording }))}
        onAdd={isOwner ? onUploadRecording : undefined}
        adding={uploading === 'recording'}
      />
      {open.recording && (
        <div className="ps-2">
          {lecture.recordings.length === 0 ? (
            <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימות הקלטות.</p>
          ) : (
            lecture.recordings.map(r => (
              <ItemRow
                key={r.id}
                label={r.title}
                active={selection.kind === 'recording' && selection.id === r.id}
                onClick={() => setSelection({ kind: 'recording', id: r.id })}
                onDelete={isOwner ? () => onDeleteRecording(r.id) : undefined}
              />
            ))
          )}
        </div>
      )}

      <SectionHeader
        icon={FileText}
        label="הערות"
        count={lecture.notes.length}
        isOpen={open.note}
        onToggle={() => setOpen(o => ({ ...o, note: !o.note }))}
        onAdd={isOwner ? onUploadNote : undefined}
        adding={uploading === 'note'}
      />
      {open.note && (
        <div className="ps-2 pb-2">
          {lecture.notes.length === 0 ? (
            <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימות הערות.</p>
          ) : (
            lecture.notes.map(n => (
              <ItemRow
                key={n.id}
                label={n.title}
                active={selection.kind === 'note' && selection.id === n.id}
                onClick={() => setSelection({ kind: 'note', id: n.id })}
                onDelete={isOwner ? () => onDeleteNote(n.id) : undefined}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function UnifiedRow({ lecture, active, onClick }: { lecture: Lecture; active: boolean; onClick: () => void }) {
  const hasContent = Boolean(lecture.unified_summary?.trim());
  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-start transition-colors',
        active ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'hover:bg-[#F7F7F5] text-[#37352F] border border-transparent',
      ].join(' ')}
    >
      <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
      <span className="flex-1 truncate text-sm font-medium">סיכום מאוחד</span>
      <span className="text-[10px] font-medium text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded shrink-0">AI</span>
      {lecture.unified_summary_processing && (
        <Loader2 className="w-3 h-3 animate-spin text-indigo-600 shrink-0" />
      )}
      {!hasContent && !lecture.unified_summary_processing && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#C4C4C4] shrink-0" title="עוד לא יוצר" />
      )}
    </button>
  );
}

function SectionHeader({
  icon: Icon, label, count, isOpen, onToggle, onAdd, adding,
}: {
  icon: any; label: string; count: number;
  isOpen: boolean; onToggle: () => void;
  onAdd?: () => void; adding?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 mt-2 px-1">
      <button
        onClick={onToggle}
        className="flex-1 flex items-center gap-1.5 px-1.5 py-1.5 text-xs font-semibold text-[#37352F] hover:bg-[#F7F7F5] rounded"
      >
        {isOpen
          ? <ChevronDown className="w-3 h-3 rtl:rotate-180 shrink-0" />
          : <ChevronRight className="w-3 h-3 rtl:rotate-180 shrink-0" />}
        <Icon className="w-3.5 h-3.5 text-[#787774]" />
        <span className="truncate flex-1 text-start">{label}</span>
        <span className="text-[#C4C4C4] font-normal">({count})</span>
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          disabled={Boolean(adding)}
          className="p-1 rounded text-[#787774] hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
          title="Add"
        >
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

function ItemRow({
  label, active, onClick, onEdit, onDelete,
}: {
  label: string; active: boolean; onClick: () => void;
  onEdit?: () => void; onDelete?: () => void;
}) {
  return (
    <div className={[
      'group flex items-center gap-1 my-0.5 rounded-md',
      active ? 'bg-indigo-50' : 'hover:bg-[#F7F7F5]',
    ].join(' ')}>
      <button
        onClick={onClick}
        className={[
          'flex-1 truncate text-start px-2 py-1.5 text-xs',
          active ? 'text-indigo-700 font-medium' : 'text-[#37352F]',
        ].join(' ')}
      >
        {label}
      </button>
      {onEdit && (
        <button
          onClick={onEdit}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#787774] hover:text-indigo-600"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => { if (confirm('למחוק?')) void onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#787774] hover:text-red-600 me-1"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Main-pane renderers
// ══════════════════════════════════════════════════════════════════════════

function UnifiedSummaryPane({
  lecture, isOwner, onGenerateClick,
}: {
  lecture: Lecture; isOwner: boolean; onGenerateClick: () => void;
}) {
  const hasContent  = Boolean(lecture.unified_summary?.trim());
  const generating  = lecture.unified_summary_processing;
  const canGenerate = isOwner && lecture.lecturer_summaries.length > 0;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 flex-wrap px-6 py-4 bg-white border-b border-[#E8E8E6]">
        <div className="min-w-0">
          <p className="text-xs text-indigo-600 font-medium flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            סיכום מאוחד · נוצר על ידי AI
          </p>
          {lecture.unified_summary_generated_at && (
            <p className="text-[10px] text-[#C4C4C4] mt-0.5">
              עודכן: {new Date(lecture.unified_summary_generated_at).toLocaleString()}
            </p>
          )}
        </div>
        {isOwner && (
          <button
            onClick={onGenerateClick}
            disabled={!canGenerate || generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shrink-0"
            title={canGenerate ? '' : 'הוסף לפחות סיכום מרצה (PDF) אחד תחילה'}
          >
            {generating
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : hasContent ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'מייצר…' : hasContent ? 'ייצר מחדש' : 'ייצר סיכום'}
          </button>
        )}
      </div>

      {lecture.unified_summary_error && !generating && (
        <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          {lecture.unified_summary_error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bg-[#FAFAF9] px-2 sm:px-6 py-6">
        {generating ? (
          <UnifiedSummaryLoading />
        ) : hasContent ? (
          <DocPage>
            <article dir="auto" className="prose prose-base max-w-none text-[#37352F]">
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={summaryMdComponents}
              >
                {lecture.unified_summary!}
              </ReactMarkdown>
            </article>
          </DocPage>
        ) : (
          <UnifiedSummaryEmptyState
            hasLecturerSummary={lecture.lecturer_summaries.length > 0}
            isOwner={isOwner}
          />
        )}
      </div>
    </div>
  );
}

/** Renders children inside a PDF-page-styled white card so the unified
 *  summary feels like a document and not a chat message. */
function DocPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[820px] bg-white border border-[#E8E8E6] rounded-lg shadow-sm px-6 sm:px-10 py-8">
      {children}
    </div>
  );
}

function UnifiedSummaryLoading() {
  return (
    <DocPage>
      <div className="flex items-center gap-2 text-sm text-[#787774] mb-4">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
        מייצר סיכום מאוחד — זה לוקח לרוב 30 עד 90 שניות…
      </div>
      <div className="space-y-3">
        <div className="h-3 bg-[#EFEFED] rounded-full w-full animate-pulse" />
        <div className="h-3 bg-[#EFEFED] rounded-full w-5/6 animate-pulse" />
        <div className="h-3 bg-[#EFEFED] rounded-full w-4/6 animate-pulse" />
        <div className="h-3 bg-[#EFEFED] rounded-full w-3/6 animate-pulse" />
      </div>
    </DocPage>
  );
}

function UnifiedSummaryEmptyState({ hasLecturerSummary, isOwner }: { hasLecturerSummary: boolean; isOwner: boolean }) {
  return (
    <DocPage>
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-indigo-600" />
        </div>
        <p className="text-sm text-[#37352F] font-medium">לא יוצר עדיין סיכום מאוחד</p>
        <p className="text-xs text-[#787774] max-w-md leading-relaxed">
          {hasLecturerSummary
            ? (isOwner ? 'לחץ "ייצר סיכום" כדי להפיק את הסיכום המאוחד.' : 'בעלי הקורס עוד לא ייצרו את הסיכום המאוחד.')
            : 'יש להעלות לפחות PDF של סיכום מרצה אחד לפני שאפשר לייצר סיכום מאוחד.'}
        </p>
      </div>
    </DocPage>
  );
}

interface AttachmentLike {
  id: number;
  title: string;
  file_path: string | null;
  doc_type: string;
}

function DocViewerPane({ attachment, caption }: { attachment: AttachmentLike; caption: string }) {
  const url = attachmentUrl(attachment.file_path);
  const isImage = attachment.doc_type === 'IMAGE';
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-6 py-3 bg-white border-b border-[#E8E8E6]">
        <div className="min-w-0">
          <p className="text-[11px] text-[#787774]">{caption}</p>
          <h3 className="text-sm font-semibold text-[#37352F] truncate" dir="auto">{attachment.title}</h3>
        </div>
        {url && (
          <a
            href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 shrink-0"
          >
            <Download className="w-3 h-3" /> Download
          </a>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-[#FAFAF9]">
        {!url ? (
          <p className="text-xs text-[#C4C4C4] py-12 text-center">קובץ לא זמין.</p>
        ) : isImage ? (
          <div className="h-full overflow-y-auto p-6 flex items-start justify-center">
            <img src={url} alt={attachment.title} className="max-w-full max-h-full object-contain rounded-lg border border-[#E8E8E6]" />
          </div>
        ) : (
          <iframe src={url} title={attachment.title} className="w-full h-full border-0" />
        )}
      </div>
    </div>
  );
}

function RecordingPane({ attachment }: { attachment: LectureAttachment }) {
  const url = attachmentUrl(attachment.file_path);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-6 py-3 bg-white border-b border-[#E8E8E6]">
        <div className="min-w-0">
          <p className="text-[11px] text-[#787774] flex items-center gap-1">
            <Mic className="w-3 h-3" /> הקלטה
          </p>
          <h3 className="text-sm font-semibold text-[#37352F] truncate" dir="auto">{attachment.title}</h3>
        </div>
        {url && (
          <a
            href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 shrink-0"
          >
            <Download className="w-3 h-3" /> Download
          </a>
        )}
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-6 bg-[#FAFAF9]">
        {!url ? (
          <p className="text-xs text-[#C4C4C4] py-12 text-center">קובץ לא זמין.</p>
        ) : (
          <div className="w-full max-w-2xl bg-white rounded-xl border border-[#E8E8E6] p-6 shadow-sm">
            <audio controls src={url} className="w-full" />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyMainPane() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="w-12 h-12 rounded-xl bg-[#F7F7F5] border border-[#E8E8E6] flex items-center justify-center">
        <BookOpen className="w-5 h-5 text-[#787774]" />
      </div>
      <p className="mt-3 text-sm text-[#37352F] font-medium">בחר פריט מהתפריט בצד</p>
      <p className="mt-1 text-xs text-[#787774] max-w-sm">
        סיכום מאוחד / סיכומי מרצה / סיכומי תלמידים / הקלטות / הערות.
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Modals
// ══════════════════════════════════════════════════════════════════════════

/** Unified upload modal for lecturer- and student-summary PDFs (F-035).
 *  Both summaries share the same shape: file + title (+ lecturer for the
 *  lecturer variant). */
function SummaryUploadModal({
  kind, lectureId, editing, courseLecturers, onClose, onSaved,
}: {
  kind: 'lecturer' | 'student';
  lectureId: number;
  editing: LectureLecturerSummary | LectureStudentSummary | null;
  courseLecturers: CourseLecturer[];
  onClose: () => void;
  onSaved: (saved: LectureLecturerSummary | LectureStudentSummary) => void;
}) {
  const initialLecturerId = kind === 'lecturer'
    ? ((editing as LectureLecturerSummary | null)?.lecturer_id
        ?? (courseLecturers.length === 1 ? courseLecturers[0].id : null))
    : null;

  const [title, setTitle]       = useState(editing?.title ?? (kind === 'lecturer' ? 'סיכום מרצה' : 'סיכום תלמיד'));
  const [lecturerId, setLecturerId] = useState<number | null>(initialLecturerId);
  const [file, setFile]         = useState<File | null>(null);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadAndAttach(): Promise<number | null> {
    if (!file) return editing?.user_document_id ?? null;
    try {
      const upRes = await api.uploadDocument(file, false);
      return upRes.data.id;
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const existing = e?.response?.status === 409 && typeof detail === 'object'
        ? detail?.existing_user_document_id : undefined;
      if (typeof existing === 'number') return existing;
      throw e;
    }
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const userDocId = await uploadAndAttach();
      if (!userDocId && !editing) {
        throw new Error('נדרש קובץ PDF/Word לסיכום.');
      }
      const titleClean = title.trim() || (kind === 'lecturer' ? 'סיכום מרצה' : 'סיכום תלמיד');
      if (kind === 'lecturer') {
        const ed = editing as LectureLecturerSummary | null;
        const res = ed
          ? await api.updateLectureLecturerSummary(lectureId, ed.id, {
              title:            titleClean,
              user_document_id: userDocId ?? undefined,
              lecturer_id:      lecturerId,
            })
          : await api.createLectureLecturerSummary(lectureId, {
              user_document_id: userDocId!,
              title:            titleClean,
              lecturer_id:      lecturerId,
            });
        onSaved(res.data);
      } else {
        const ed = editing as LectureStudentSummary | null;
        const res = ed
          ? await api.updateLectureStudentSummary(lectureId, ed.id, {
              title:            titleClean,
              user_document_id: userDocId ?? undefined,
            })
          : await api.createLectureStudentSummary(lectureId, {
              user_document_id: userDocId!,
              title:            titleClean,
            });
        onSaved(res.data);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e?.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const headingNew = kind === 'lecturer' ? 'סיכום מרצה חדש' : 'סיכום תלמיד חדש';
  const headingEdit = kind === 'lecturer' ? 'עריכת סיכום מרצה' : 'עריכת סיכום תלמיד';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 border border-[#E8E8E6] max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[#37352F]">{editing ? headingEdit : headingNew}</h3>
          <button onClick={onClose} className="p-1.5 text-[#787774] hover:bg-[#F7F7F5] rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        {err && (
          <div className="mb-3 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700">{err}</div>
        )}
        <div className="space-y-3">
          {kind === 'lecturer' && (
            <label className="block">
              <span className="text-xs text-[#787774] font-medium">מרצה</span>
              <select
                value={lecturerId ?? ''}
                onChange={e => setLecturerId(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">{courseLecturers.length === 0 ? 'אין מרצים בקורס' : '-- בחר מרצה --'}</option>
                {courseLecturers.map(cl => (
                  <option key={cl.id} value={cl.id}>
                    {cl.name}{cl.role && cl.role !== 'lecturer' ? ` (${cl.role})` : ''}
                  </option>
                ))}
              </select>
              {courseLecturers.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-700">
                  אין מרצים בקורס — אפשר להוסיף ידנית בלשונית Syllabus.
                </p>
              )}
            </label>
          )}
          <label className="block">
            <span className="text-xs text-[#787774] font-medium">כותרת</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              dir="auto"
              placeholder="למשל: סיכום ראשי / גרסה מתוקנת / 2026A"
              className="mt-1 w-full border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <div>
            <span className="text-xs text-[#787774] font-medium">קובץ הסיכום (PDF/Word)</span>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {file ? file.name : (editing?.file_path ? 'החלף קובץ' : 'בחר קובץ')}
              </button>
              {file && (
                <button
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="text-xs text-[#787774] hover:text-red-600"
                >
                  הסר
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={LECTURE_SUMMARY_TYPES}
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) {
                  setFile(f);
                  if (!title.trim() || title === 'סיכום מרצה' || title === 'סיכום תלמיד') {
                    setTitle(f.name.replace(/\.(pdf|docx?|DOCX?)$/i, ''));
                  }
                }
              }}
            />
            {editing && (
              <p className="mt-1 text-[11px] text-[#787774]">
                {file ? 'הקובץ הקיים יוחלף בחדש.' : 'השאר ריק כדי לשמור את הקובץ הקיים.'}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6]">
            בטל
          </button>
          <button
            onClick={save}
            disabled={saving || (!editing && !file)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            שמור
          </button>
        </div>
      </div>
    </div>
  );
}

function GeneratePicker({
  summaries, onCancel, onPick,
}: {
  summaries: LectureLecturerSummary[];
  onCancel: () => void;
  onPick: (id: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-5 border border-[#E8E8E6]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[#37352F]">בחר סיכום מרצה לקלט</h3>
          <button onClick={onCancel} className="p-1.5 text-[#787774] hover:bg-[#F7F7F5] rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-[#787774] mb-3">
          הסקיל יקבל את התוכן של הסיכום הנבחר כקלט הראשי.
        </p>
        <ul className="space-y-1 max-h-[50vh] overflow-y-auto">
          {summaries.map(s => (
            <li key={s.id}>
              <button
                onClick={() => onPick(s.id)}
                className="w-full text-start px-3 py-2 rounded-lg border border-[#E8E8E6] hover:border-indigo-300 hover:bg-indigo-50"
              >
                <div className="text-sm font-medium text-[#37352F]">{s.title}</div>
                {s.lecturer_name && (
                  <div className="text-[11px] text-[#787774] mt-0.5">{s.lecturer_name}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConfirmDeleteLecture({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 border border-red-200">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <h3 className="text-sm font-semibold text-red-700">Delete this lecture?</h3>
        </div>
        <p className="text-xs text-[#787774] mb-4 leading-relaxed">
          כל הסיכומים, ההקלטות וההערות שצורפו ימחקו. הקבצים עצמם נשארים בספריה.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6]"
          >
            בטל
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
          >
            <Trash2 className="w-3.5 h-3.5" /> מחק
          </button>
        </div>
      </div>
    </div>
  );
}

