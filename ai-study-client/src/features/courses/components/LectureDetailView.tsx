import { useState, useRef } from 'react';
import {
  ArrowLeft, Calendar, Mic, FileText, Image, Trash2, Upload,
  Loader2, Save, Pencil, AlertTriangle, Download,
} from 'lucide-react';
import { api } from '../../../services/api';
import { LECTURE_RECORDING_TYPES, LECTURE_NOTES_TYPES } from '../../../utils/fileIcons';

// Backend shape from GET /api/v1/lectures/{id}.
export interface Lecture {
  id:             number;
  course_id:      number;
  title:          string;
  lecture_date:   string | null;
  manual_summary: string | null;
  recording: { id: number; title: string; file_path: string | null; doc_type: string } | null;
  notes:     { id: number; title: string; file_path: string | null; doc_type: string } | null;
  created_at: string | null;
  updated_at: string | null;
}

interface LectureDetailViewProps {
  lecture:  Lecture;
  isOwner:  boolean;
  onBack:   () => void;
  onChange: (updated: Lecture) => void;
  onDelete: () => Promise<void>;
  onRename: () => void;
}

const UPLOADS_BASE = (import.meta.env.VITE_AI_API_URL ?? '').replace(/\/$/, '');

function attachmentUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  // BaseDocument.file_path is like "uploads/abcd_filename.mp3" — served by
  // FastAPI's StaticFiles at /uploads/* (Nginx proxies the same path).
  const clean = filePath.replace(/^\/+/, '');
  return `${UPLOADS_BASE}/${clean}`;
}

export default function LectureDetailView({
  lecture, isOwner, onBack, onChange, onDelete, onRename,
}: LectureDetailViewProps) {
  const [summary, setSummary]       = useState(lecture.manual_summary ?? '');
  const [savingSummary, setSavingSummary] = useState(false);
  const [savingFile, setSavingFile] = useState<'recording' | 'notes' | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recordingInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef     = useRef<HTMLInputElement>(null);

  const summaryDirty = (summary ?? '') !== (lecture.manual_summary ?? '');

  async function handleSaveSummary() {
    if (!summaryDirty || savingSummary) return;
    setSavingSummary(true);
    setError(null);
    try {
      const res = await api.updateLecture(lecture.id, { manual_summary: summary });
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save summary.');
    } finally {
      setSavingSummary(false);
    }
  }

  async function handleAttachFile(file: File, kind: 'recording' | 'notes') {
    setSavingFile(kind);
    setError(null);
    try {
      // 1. Upload to library (CAS dedup gives us an existing ID if the user
      //    already had this file — handle the 409 just like F-020.)
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
        if (typeof existing === 'number') {
          userDocId = existing;
        } else {
          throw err;
        }
      }

      // 2. Attach to lecture.
      const fieldName = kind === 'recording'
        ? 'recording_user_document_id'
        : 'notes_user_document_id';
      const res = await api.updateLecture(lecture.id, { [fieldName]: userDocId } as any);
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to attach file.');
    } finally {
      setSavingFile(null);
    }
  }

  async function handleDetach(kind: 'recording' | 'notes') {
    setSavingFile(kind);
    setError(null);
    try {
      const fieldName = kind === 'recording'
        ? 'recording_user_document_id'
        : 'notes_user_document_id';
      const res = await api.updateLecture(lecture.id, { [fieldName]: null } as any);
      onChange(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to detach file.');
    } finally {
      setSavingFile(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Breadcrumb + actions ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F] shrink-0">
            <ArrowLeft className="w-4 h-4" /> Lectures
          </button>
          <span className="text-[#C4C4C4]">/</span>
          <h2 className="text-base font-semibold text-[#37352F] truncate">{lecture.title}</h2>
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

      {/* Date strip */}
      {lecture.lecture_date && (
        <div className="flex items-center gap-2 text-xs text-[#787774]">
          <Calendar className="w-3.5 h-3.5" />
          {new Date(lecture.lecture_date).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
          })}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Recording ──────────────────────────────────────────────────── */}
      <AttachmentSection
        kind="recording"
        icon={Mic}
        title="Recording"
        description="Audio capture of the lecture."
        attachment={lecture.recording}
        isOwner={isOwner}
        isSaving={savingFile === 'recording'}
        onPick={() => recordingInputRef.current?.click()}
        onDetach={() => handleDetach('recording')}
        renderPlayer={(url) => <audio controls src={url} className="w-full mt-3" />}
      />
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

      {/* ── Notes ──────────────────────────────────────────────────────── */}
      <AttachmentSection
        kind="notes"
        icon={lecture.notes?.doc_type === 'IMAGE' ? Image : FileText}
        title="Notes"
        description="PDF or photo of handwritten notes."
        attachment={lecture.notes}
        isOwner={isOwner}
        isSaving={savingFile === 'notes'}
        onPick={() => notesInputRef.current?.click()}
        onDetach={() => handleDetach('notes')}
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

      {/* ── Manual summary ─────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[#37352F]">Summary</h3>
            <p className="text-xs text-[#787774] mt-0.5">
              Write your own summary now. Phase 2 will let the AI fuse the
              recording transcript and notes into a structured summary.
            </p>
          </div>
          {isOwner && summaryDirty && (
            <button
              onClick={handleSaveSummary}
              disabled={savingSummary}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shrink-0"
            >
              {savingSummary ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          )}
        </div>
        <textarea
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="What did the lecturer cover? Key points, exercises, worked examples…"
          dir="auto"
          rows={8}
          readOnly={!isOwner}
          className="w-full border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
        />
      </div>

      {/* ── Delete confirm (typed) ─────────────────────────────────────── */}
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

  // ── inline helper component ─────────────────────────────────────────
  // Defined as an inner-scope arrow so it can read the typed Lecture
  // attachment shape without re-importing.
  function AttachmentSection({
    kind, icon: Icon, title, description, attachment, isOwner, isSaving,
    onPick, onDetach, renderPlayer,
  }: {
    kind: 'recording' | 'notes';
    icon: typeof Mic;
    title: string;
    description: string;
    attachment: Lecture['recording'];
    isOwner: boolean;
    isSaving: boolean;
    onPick: () => void;
    onDetach: () => void;
    renderPlayer?: (url: string) => React.ReactNode;
  }) {
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
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 shrink-0"
                    >
                      <Download className="w-3 h-3" /> open
                    </a>
                  )}
                </div>
                {url && renderPlayer?.(url)}
                {isOwner && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={onPick}
                      disabled={isSaving}
                      className="text-xs text-[#787774] hover:text-indigo-600 underline-offset-2 hover:underline"
                    >
                      Replace…
                    </button>
                    <span className="text-[#C4C4C4]">·</span>
                    <button
                      onClick={onDetach}
                      disabled={isSaving}
                      className="text-xs text-[#787774] hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ) : isOwner ? (
              <button
                onClick={onPick}
                disabled={isSaving}
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
}
