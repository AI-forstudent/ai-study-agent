import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Calendar, Mic, FileText, Image as ImageIcon, Trash2, Upload,
  Loader2, Save, Pencil, AlertTriangle, Download, Sparkles, RefreshCw,
  Send, MessageSquare, X, Plus,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

import { api } from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import { LECTURE_RECORDING_TYPES, LECTURE_NOTES_TYPES } from '../../../utils/fileIcons';

// ── Types ────────────────────────────────────────────────────────────────────

/** Backend shape from `GET /api/v1/lectures/{id}` (F-033). */
export interface Lecture {
  id:                number;
  course_id:         number;
  title:             string;
  lecture_date:      string | null;
  lecturer_summary:  string | null;
  student_summaries: string | null;
  unified_summary:                string | null;
  unified_summary_processing:     boolean;
  unified_summary_error:          string | null;
  unified_summary_generated_at:   string | null;
  recording: { id: number; title: string; file_path: string | null; doc_type: string } | null;
  notes:     { id: number; title: string; file_path: string | null; doc_type: string } | null;
  created_at: string | null;
  updated_at: string | null;
}

interface LectureThreadMessage {
  id: number; role: 'user' | 'assistant' | string; content: string; created_at?: string | null;
}
interface LectureThread {
  id: number; title?: string | null; session_title?: string | null; emoji?: string | null;
  created_at?: string | null; messages: LectureThreadMessage[];
}

type TabKey = 'unified' | 'lecturer' | 'student' | 'recording' | 'notes';

// ── Constants ───────────────────────────────────────────────────────────────

const UPLOADS_BASE = (import.meta.env.VITE_AI_API_URL ?? '').replace(/\/$/, '');

function attachmentUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const clean = filePath.replace(/^\/+/, '');
  return `${UPLOADS_BASE}/${clean}`;
}

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'unified',   label: 'סיכום מאוחד',    icon: Sparkles },
  { key: 'lecturer',  label: 'סיכום מרצה',     icon: Pencil   },
  { key: 'student',   label: 'סיכומי תלמידים', icon: FileText },
  { key: 'recording', label: 'הקלטה',          icon: Mic      },
  { key: 'notes',     label: 'הערות',          icon: FileText },
];

const STANDALONE_CHAT_API = `${UPLOADS_BASE}/api/v1/chat/`;

// ── Markdown renderer used for the Unified Summary tab ──────────────────────
// Document-style: full markdown surface (headings, lists, tables, code blocks,
// KaTeX) with comfortable typography. Mirrors ChatPanel's `assistantMdComponents`
// for consistent feel, but lives next to its consumer so cross-feature edits
// don't ripple.
const summaryMdComponents = {
  p:      ({ node, ...props }: any) => <p dir="auto" {...props} />,
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

// ── Default tab selection per the user spec ─────────────────────────────────
// Priority: unified → lecturer → student → recording → notes. First non-empty
// wins. This is intentionally biased toward summaries (which carry the
// pedagogical signal) before raw materials.
function pickDefaultTab(lec: Lecture): TabKey {
  if (lec.unified_summary?.trim())   return 'unified';
  if (lec.lecturer_summary?.trim())  return 'lecturer';
  if (lec.student_summaries?.trim()) return 'student';
  if (lec.recording)                 return 'recording';
  if (lec.notes)                     return 'notes';
  return 'unified';
}

// ── Component ───────────────────────────────────────────────────────────────

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
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>(() => pickDefaultTab(lecture));

  // ── Editable summary fields ───────────────────────────────────────────────
  // Local state for the textareas so we can show a dirty-state Save button
  // without firing a PUT on every keystroke. Reset when the lecture prop
  // changes from outside (e.g. after a successful save).
  const [lecturerDraft, setLecturerDraft] = useState(lecture.lecturer_summary ?? '');
  const [studentDraft,  setStudentDraft]  = useState(lecture.student_summaries ?? '');
  useEffect(() => { setLecturerDraft(lecture.lecturer_summary  ?? ''); }, [lecture.id, lecture.lecturer_summary]);
  useEffect(() => { setStudentDraft(lecture.student_summaries ?? ''); }, [lecture.id, lecture.student_summaries]);
  const lecturerDirty = lecturerDraft !== (lecture.lecturer_summary ?? '');
  const studentDirty  = studentDraft  !== (lecture.student_summaries ?? '');

  const [savingField, setSavingField] = useState<'lecturer' | 'student' | null>(null);
  const [savingFile, setSavingFile]   = useState<'recording' | 'notes' | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recordingInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef     = useRef<HTMLInputElement>(null);

  // ── Unified-summary polling ───────────────────────────────────────────────
  // While the row is in `unified_summary_processing=true`, poll every 5s so
  // the user sees the result appear without a manual refresh. Stops as soon
  // as the flag flips back to false.
  useEffect(() => {
    if (!lecture.unified_summary_processing) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.getLecture(lecture.id);
        if (!cancelled) onChange(res.data);
      } catch {
        // Ignore transient failures; the next tick retries.
      }
    };
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture.id, lecture.unified_summary_processing]);

  // ── Field saves ──────────────────────────────────────────────────────────
  async function saveLecturerSummary() {
    if (!lecturerDirty || savingField) return;
    setSavingField('lecturer'); setError(null);
    try {
      const res = await api.updateLecture(lecture.id, { lecturer_summary: lecturerDraft });
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save lecturer summary.');
    } finally {
      setSavingField(null);
    }
  }
  async function saveStudentSummaries() {
    if (!studentDirty || savingField) return;
    setSavingField('student'); setError(null);
    try {
      const res = await api.updateLecture(lecture.id, { student_summaries: studentDraft });
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save student summaries.');
    } finally {
      setSavingField(null);
    }
  }

  // ── Unified-summary generation ───────────────────────────────────────────
  async function generateUnified() {
    setError(null);
    try {
      const res = await api.generateLectureUnifiedSummary(lecture.id);
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to start generation.');
    }
  }

  // ── File attach / detach ─────────────────────────────────────────────────
  async function handleAttachFile(file: File, kind: 'recording' | 'notes') {
    setSavingFile(kind); setError(null);
    try {
      let userDocId: number;
      try {
        const upRes = await api.uploadDocument(file, false);
        userDocId = upRes.data.id;
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        const existing =
          err?.response?.status === 409 && typeof detail === 'object'
            ? detail?.existing_user_document_id
            : undefined;
        if (typeof existing === 'number') userDocId = existing;
        else throw err;
      }
      const fieldName = kind === 'recording'
        ? 'recording_user_document_id' : 'notes_user_document_id';
      const res = await api.updateLecture(lecture.id, { [fieldName]: userDocId } as any);
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to attach file.');
    } finally {
      setSavingFile(null);
    }
  }

  async function handleDetach(kind: 'recording' | 'notes') {
    setSavingFile(kind); setError(null);
    try {
      const fieldName = kind === 'recording'
        ? 'recording_user_document_id' : 'notes_user_document_id';
      const res = await api.updateLecture(lecture.id, { [fieldName]: null } as any);
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to detach file.');
    } finally {
      setSavingFile(null);
    }
  }

  // ── In-session sidebar collapse ──────────────────────────────────────────
  // Treat the lecture viewer as a "session" — same UX as the doc workspace:
  // the global app sidebar collapses on entry and restores on unmount.
  // (AppLayout reads `inSession` from the store.)
  const setInSession = useAppStore(s => s.setInSession);
  useEffect(() => {
    setInSession(true);
    return () => setInSession(false);
  }, [setInSession]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Top breadcrumb + actions ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3 px-1 pb-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#E8E8E6]">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F] shrink-0">
            <ArrowLeft className="w-4 h-4" /> Lectures
          </button>
          <span className="text-[#C4C4C4]">/</span>
          <h2 className="text-base font-semibold text-[#37352F] truncate">{lecture.title}</h2>
          {lecture.lecture_date && (
            <span className="hidden md:flex items-center gap-1 text-xs text-[#787774] shrink-0 ms-2">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(lecture.lecture_date).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
              })}
            </span>
          )}
        </div>
        {isOwner && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onRename}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#787774] hover:text-[#37352F] border border-[#E8E8E6] rounded-lg hover:bg-[#F7F7F5]"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto px-1 py-2 border-b border-[#E8E8E6]">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          const isUnified = t.key === 'unified';
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg whitespace-nowrap shrink-0 transition-colors',
                active
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] border border-transparent',
              ].join(' ')}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {isUnified && (
                <span className="ms-1 text-[10px] font-medium text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded">
                  AI · כולל הכל
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 mx-1 mt-3 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Split: content tab on the left, chat on the right ───────────── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 mt-3 px-1">
        {/* Left / main pane */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'unified' && (
            <UnifiedSummaryPane
              lecture={lecture}
              isOwner={isOwner}
              onGenerate={generateUnified}
            />
          )}

          {tab === 'lecturer' && (
            <SummaryTextareaPane
              title="סיכום מרצה"
              description="הסיכום הרשמי של המרצה. זה המקור האותנטי שמזין את הסיכום המאוחד."
              value={lecturerDraft}
              setValue={setLecturerDraft}
              dirty={lecturerDirty}
              saving={savingField === 'lecturer'}
              readOnly={!isOwner}
              onSave={saveLecturerSummary}
            />
          )}

          {tab === 'student' && (
            <SummaryTextareaPane
              title="סיכומי תלמידים"
              description="סיכומים שלי או של עמיתים. אינם נכללים בייצור הסיכום המאוחד."
              value={studentDraft}
              setValue={setStudentDraft}
              dirty={studentDirty}
              saving={savingField === 'student'}
              readOnly={!isOwner}
              onSave={saveStudentSummaries}
            />
          )}

          {tab === 'recording' && (
            <AttachmentPane
              kind="recording"
              icon={Mic}
              title="Recording"
              description="Audio capture of the lecture."
              attachment={lecture.recording}
              isOwner={isOwner}
              isSaving={savingFile === 'recording'}
              onPick={() => recordingInputRef.current?.click()}
              onDetach={() => handleDetach('recording')}
              renderPreview={(url) => <audio controls src={url} className="w-full mt-4" />}
            />
          )}

          {tab === 'notes' && (
            <AttachmentPane
              kind="notes"
              icon={lecture.notes?.doc_type === 'IMAGE' ? ImageIcon : FileText}
              title="Notes"
              description="PDF or photo of handwritten notes."
              attachment={lecture.notes}
              isOwner={isOwner}
              isSaving={savingFile === 'notes'}
              onPick={() => notesInputRef.current?.click()}
              onDetach={() => handleDetach('notes')}
              renderPreview={(url) => (
                lecture.notes?.doc_type === 'IMAGE'
                  ? <img src={url} alt="Notes" className="w-full max-h-[70vh] object-contain mt-4 rounded-lg border border-[#E8E8E6]" />
                  : <iframe src={url} className="w-full mt-4 rounded-lg border border-[#E8E8E6]" style={{ height: '70vh' }} />
              )}
            />
          )}
        </div>

        {/* Right / chat pane */}
        <div className="lg:w-[380px] xl:w-[420px] shrink-0 min-h-[320px] lg:min-h-0">
          <LectureChatPane lectureId={lecture.id} courseId={lecture.course_id} />
        </div>
      </div>

      {/* ── Hidden file inputs ───────────────────────────────────────────── */}
      <input
        ref={recordingInputRef}
        type="file"
        accept={LECTURE_RECORDING_TYPES}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleAttachFile(f, 'recording');
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
          if (f) void handleAttachFile(f, 'notes');
        }}
      />

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelete(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 border border-red-200">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-semibold text-red-700">Delete this lecture?</h3>
            </div>
            <p className="text-xs text-[#787774] mb-4 leading-relaxed">
              The recording and notes files stay in your library — only the lecture row is removed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-sm text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6]"
              >
                Cancel
              </button>
              <button
                onClick={async () => { await onDelete(); setConfirmDelete(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Unified-summary pane ────────────────────────────────────────────────────

interface UnifiedSummaryPaneProps {
  lecture: Lecture;
  isOwner: boolean;
  onGenerate: () => Promise<void>;
}

function UnifiedSummaryPane({ lecture, isOwner, onGenerate }: UnifiedSummaryPaneProps) {
  const canGenerate = isOwner && Boolean(lecture.lecturer_summary?.trim());
  const hasContent  = Boolean(lecture.unified_summary?.trim());
  const generating  = lecture.unified_summary_processing;

  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[#37352F] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            סיכום מאוחד
          </h3>
          <p className="text-xs text-[#787774] mt-1 leading-relaxed">
            סיכום מקיף שמיוצר על ידי AI. משלב את סיכום המרצה
            (ובהמשך גם את תמלול ההקלטה, התרגולים ושיעורי הבית) למסמך לימוד אחד.
          </p>
          {lecture.unified_summary_generated_at && (
            <p className="text-[10px] text-[#C4C4C4] mt-1">
              עודכן: {new Date(lecture.unified_summary_generated_at).toLocaleString()}
            </p>
          )}
        </div>
        {isOwner && (
          <button
            onClick={onGenerate}
            disabled={!canGenerate || generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shrink-0"
            title={canGenerate ? '' : 'יש למלא את שדה סיכום מרצה תחילה'}
          >
            {generating
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : hasContent
                ? <RefreshCw className="w-3.5 h-3.5" />
                : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'מייצר…' : hasContent ? 'ייצר מחדש' : 'ייצר סיכום'}
          </button>
        )}
      </div>

      {lecture.unified_summary_error && !generating && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          {lecture.unified_summary_error}
        </div>
      )}

      {generating ? (
        <UnifiedSummaryLoading />
      ) : hasContent ? (
        <article
          dir="auto"
          className="prose prose-sm max-w-none text-[#37352F] leading-relaxed"
        >
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={summaryMdComponents}
          >
            {lecture.unified_summary!}
          </ReactMarkdown>
        </article>
      ) : (
        <UnifiedSummaryEmptyState
          hasLecturerSummary={Boolean(lecture.lecturer_summary?.trim())}
          isOwner={isOwner}
        />
      )}
    </div>
  );
}

function UnifiedSummaryLoading() {
  return (
    <div className="space-y-3 py-3">
      <div className="flex items-center gap-2 text-sm text-[#787774]">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
        מייצר סיכום מאוחד — זה לוקח לרוב 30 עד 90 שניות…
      </div>
      <div className="h-3 bg-[#EFEFED] rounded-full w-full animate-pulse" />
      <div className="h-3 bg-[#EFEFED] rounded-full w-5/6 animate-pulse" />
      <div className="h-3 bg-[#EFEFED] rounded-full w-4/6 animate-pulse" />
      <div className="h-3 bg-[#EFEFED] rounded-full w-3/6 animate-pulse" />
    </div>
  );
}

function UnifiedSummaryEmptyState({ hasLecturerSummary, isOwner }: { hasLecturerSummary: boolean; isOwner: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-indigo-600" />
      </div>
      <p className="text-sm text-[#37352F] font-medium">לא יוצר עדיין סיכום מאוחד</p>
      <p className="text-xs text-[#787774] max-w-md leading-relaxed">
        {hasLecturerSummary
          ? (isOwner
              ? 'לחץ "ייצר סיכום" כדי להפיק סיכום שילובי על בסיס סיכום המרצה.'
              : 'בעלי הקורס עוד לא ייצרו את הסיכום המאוחד.')
          : 'יש למלא את שדה "סיכום מרצה" לפחות לפני שאפשר לייצר סיכום מאוחד.'}
      </p>
    </div>
  );
}

// ── Editable summary textarea pane ──────────────────────────────────────────

interface SummaryTextareaPaneProps {
  title:       string;
  description: string;
  value:       string;
  setValue:    (v: string) => void;
  dirty:       boolean;
  saving:      boolean;
  readOnly:    boolean;
  onSave:      () => Promise<void>;
}

function SummaryTextareaPane({
  title, description, value, setValue, dirty, saving, readOnly, onSave,
}: SummaryTextareaPaneProps) {
  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#37352F]">{title}</h3>
          <p className="text-xs text-[#787774] mt-0.5">{description}</p>
        </div>
        {!readOnly && dirty && (
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shrink-0"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="כתוב כאן…"
        dir="auto"
        readOnly={readOnly}
        rows={18}
        className="w-full border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
      />
    </div>
  );
}

// ── Attachment pane (recording / notes) ─────────────────────────────────────

interface AttachmentPaneProps {
  kind:        'recording' | 'notes';
  icon:        any;
  title:       string;
  description: string;
  attachment:  Lecture['recording'];
  isOwner:     boolean;
  isSaving:    boolean;
  onPick:      () => void;
  onDetach:    () => void;
  renderPreview?: (url: string) => React.ReactNode;
}

function AttachmentPane({
  kind, icon: Icon, title, description, attachment,
  isOwner, isSaving, onPick, onDetach, renderPreview,
}: AttachmentPaneProps) {
  const url = attachmentUrl(attachment?.file_path);
  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[#37352F]">{title}</h3>
          <p className="text-xs text-[#787774] mt-0.5">{description}</p>

          {attachment ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[#37352F] truncate">{attachment.title}</span>
                {url && (
                  <a
                    href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 shrink-0"
                  >
                    <Download className="w-3 h-3" /> open
                  </a>
                )}
              </div>
              {url && renderPreview?.(url)}
              {isOwner && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={onPick} disabled={isSaving}
                    className="text-xs text-[#787774] hover:text-indigo-600 underline-offset-2 hover:underline"
                  >
                    Replace…
                  </button>
                  <span className="text-[#C4C4C4]">·</span>
                  <button
                    onClick={onDetach} disabled={isSaving}
                    className="text-xs text-[#787774] hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ) : isOwner ? (
            <button
              onClick={onPick} disabled={isSaving}
              className="mt-3 flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload {kind === 'recording' ? 'recording' : 'notes'}
            </button>
          ) : (
            <p className="mt-2 text-xs text-[#C4C4C4]">No {kind} attached.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chat pane (lecture-scoped) ──────────────────────────────────────────────
// A self-contained mini chat panel: list of past threads (collapsible),
// active thread message list with markdown rendering, and a composer.
// Talks directly to the standalone /api/v1/chat/ endpoint with course_id and
// lecture_id pinned on the first message so the new thread carries them
// server-side; subsequent messages reuse the thread's stored scoping.

function LectureChatPane({ lectureId, courseId }: { lectureId: number; courseId: number }) {
  const [threads, setThreads]           = useState<LectureThread[]>([]);
  const [activeId, setActiveId]         = useState<number | null>(null);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [showThreadList, setShowThreadList] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Initial load — pick the most recent existing thread as active if any.
  useEffect(() => {
    let cancelled = false;
    api.listLectureThreads(lectureId).then(res => {
      if (cancelled) return;
      const data: LectureThread[] = res.data ?? [];
      setThreads(data);
      setActiveId(data[0]?.id ?? null);
    }).catch(() => {
      // Empty pane on failure; user can still start a fresh chat.
    });
    return () => { cancelled = true; };
  }, [lectureId]);

  const activeThread = useMemo(
    () => threads.find(t => t.id === activeId) ?? null,
    [threads, activeId],
  );

  // Auto-scroll to bottom whenever the active thread grows.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeThread?.messages.length, activeId]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null); setSending(true);

    const optimisticUser: LectureThreadMessage = { id: Date.now(), role: 'user', content: text };
    if (activeThread) {
      const next = { ...activeThread, messages: [...activeThread.messages, optimisticUser] };
      setThreads(prev => prev.map(t => t.id === activeThread.id ? next : t));
    } else {
      // Will append when we get the new thread id back.
    }
    setInput('');

    const { selectedModelTier, selectedAIProvider } = useAppStore.getState();
    const body = {
      message:     text,
      thread_id:   activeThread?.id ?? null,
      persona_id:  null,
      model_tier:  selectedModelTier,
      ai_provider: selectedAIProvider,
      // Course + lecture scoping only matters on the FIRST message; server
      // stores them on the thread row and ignores them on subsequent turns.
      course_id:   activeThread ? null : courseId,
      lecture_id:  activeThread ? null : lectureId,
    };

    try {
      const res = await fetch(STANDALONE_CHAT_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('access_token')
            ? { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
            : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Chat API error ${res.status}`);
      }
      const data: { thread_id: number; reply: { id: number; role: string; content: string } } = await res.json();
      const assistant: LectureThreadMessage = {
        id: data.reply.id, role: 'assistant', content: data.reply.content,
      };

      if (activeThread && activeThread.id === data.thread_id) {
        setThreads(prev => prev.map(t =>
          t.id === data.thread_id
            ? { ...t, messages: [...t.messages.filter(m => m.id !== optimisticUser.id), optimisticUser, assistant] }
            : t,
        ));
      } else {
        // New thread — prepend and switch to it.
        const newThread: LectureThread = {
          id: data.thread_id, title: null, session_title: null, emoji: '💬',
          created_at: new Date().toISOString(),
          messages: [optimisticUser, assistant],
        };
        setThreads(prev => [newThread, ...prev]);
        setActiveId(newThread.id);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send message.');
      // Roll back optimistic user message on error.
      if (activeThread) {
        setThreads(prev => prev.map(t =>
          t.id === activeThread.id
            ? { ...t, messages: t.messages.filter(m => m.id !== optimisticUser.id) }
            : t,
        ));
      }
    } finally {
      setSending(false);
    }
  }

  function startNewThread() {
    setActiveId(null);
    setShowThreadList(false);
    setInput('');
  }

  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl flex flex-col h-full min-h-[420px] lg:min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E8E8E6]">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="text-sm font-semibold text-[#37352F] truncate">
            {activeThread?.session_title || activeThread?.title || 'שיחה חדשה'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowThreadList(s => !s)}
            className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5]"
            title={`Threads (${threads.length})`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={startNewThread}
            className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5]"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Threads dropdown */}
      {showThreadList && (
        <div className="border-b border-[#E8E8E6] bg-[#FAFAF9] max-h-48 overflow-y-auto">
          {threads.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[#787774]">No previous chats yet.</p>
          ) : (
            <ul>
              {threads.map(t => (
                <li key={t.id}>
                  <button
                    onClick={() => { setActiveId(t.id); setShowThreadList(false); }}
                    className={[
                      'w-full text-start px-3 py-2 text-xs hover:bg-white',
                      t.id === activeId ? 'bg-white text-indigo-700' : 'text-[#37352F]',
                    ].join(' ')}
                  >
                    <span className="truncate block">
                      {t.emoji ?? '💬'} {t.session_title || t.title || t.messages[0]?.content?.slice(0, 60) || 'Untitled'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!activeThread || activeThread.messages.length === 0 ? (
          <EmptyChatHint />
        ) : (
          activeThread.messages.map(m => (
            <ChatBubble key={m.id} role={m.role} content={m.content} />
          ))
        )}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-[#787774]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> חושב…
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 p-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-[#E8E8E6] p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="שאל שאלה על ההרצאה…"
            dir="auto"
            rows={2}
            className="flex-1 resize-none border border-[#E8E8E6] rounded-lg px-3 py-2 text-base sm:text-sm placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyChatHint() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
        <MessageSquare className="w-4 h-4 text-indigo-600" />
      </div>
      <p className="text-xs text-[#37352F] font-medium">שיחה ממוקדת בהרצאה</p>
      <p className="text-[11px] text-[#787774] max-w-[260px] leading-relaxed">
        השאלות שלך יענו על בסיס תכני ההרצאה הזו והקורס. כל שיחה חדשה
        מתחילה עם הקשר נקי.
      </p>
    </div>
  );
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : ''}>
      <div
        dir="auto"
        className={[
          isUser
            ? 'bg-[#F7F7F5] border border-[#E8E8E6] rounded-2xl px-3 py-2 max-w-[85%] text-sm text-[#37352F] whitespace-pre-wrap'
            : 'prose prose-sm max-w-none text-[#37352F]',
        ].join(' ')}
      >
        {isUser ? content : (
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={summaryMdComponents}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
