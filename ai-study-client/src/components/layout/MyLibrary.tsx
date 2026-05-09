import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, Library, Loader2, AlertCircle, CheckCircle2,
  Plus, FolderPlus, MessageSquare, ArrowLeft,
  Trash2, Star, FolderOpen, FileText,
} from 'lucide-react';
import PageContainer from './PageContainer';
import PageHeader from './PageHeader';
import LibraryLane from './LibraryLane';
import FolderCard from '../../features/documents/components/FolderCard';
import FolderModal from '../../features/documents/components/FolderModal';
import MoveToFolderModal from '../../features/documents/components/MoveToFolderModal';
import SessionCard from '../../features/sessions/components/SessionCard';
import FileCardCompact from '../../features/sessions/components/FileCardCompact';
import type { Folder } from '../../features/documents/hooks/useFolders';
import type { Persona } from '../../types/persona';
import { ACCEPTED_FILE_TYPES, FileIcon } from '../../utils/fileIcons';
import { api } from '../../services/api';

// Courses are no longer a My-Library concept — they live on the Courses page
// (sidebar entry → CoursesPage). My Library is Sessions / Files / Folders.
type CreateMenu = 'session' | 'folder';

interface Doc {
  id: number;
  title: string;
  summary: string | null;
  is_public: boolean;
  is_starred: boolean;
  folder_id: number | null;
  shared_at: string | null;
  created_at?: string | null;
  /** Bumped to now() each time the user opens this doc; drives the My Library
   *  Files-lane sort. NULL until the first post-restructure open. */
  last_opened_at?: string | null;
  doc_type?: string;
  file_path?: string;
}

/** Row shape returned by GET /api/v1/sessions/. Distinct from the lane-mixed
 *  /library/recent shape we used pre-restructure. `session_title` is the
 *  AI-generated collective title (set once at session creation, frozen);
 *  `title` is the per-thread short label used by the workspace tree. */
interface SessionRow {
  id:                number;
  title:             string | null;
  session_title:     string | null;
  emoji:             string | null;
  document_id:       number | null;
  document_title:    string | null;
  persona_id:        string | null;
  selected_text:     string | null;
  last_message:      string | null;
  message_count:     number;
  created_at:        string;
}

interface MyLibraryProps {
  userDocs: Doc[];
  isUploading: boolean;
  uploadError: string | null;
  onUploadFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectDocument: (doc: { id: number }) => void;
  onSelectSession: (sessionId: number) => void;
  onStartNewSession: () => void;
  onDeleteRequest: (doc: { id: number; title: string }) => void;
  onStarDocument: (id: number, isStarred: boolean) => void;
  onMoveDocument: (docId: number, folderId: number | null) => void;
  folders: Folder[];
  onCreateFolder: (p: { name: string; color: string | null; is_starred: boolean; persona_id: string | null; course_id?: number | null }) => Promise<Folder>;
  onUpdateFolder: (id: number, p: { name?: string; color?: string | null; is_starred?: boolean; persona_id?: string | null; course_id?: number | null }) => Promise<Folder>;
  onDeleteFolder: (id: number) => Promise<void>;
  personas: Persona[];
  /** Navigate to the dedicated Sessions search page. */
  onOpenSessionsSearch?: () => void;
  /** Cross-page folder drilldown — set by the Courses page when the user
   *  clicks a folder card inside a course's Folders tab. MyLibrary opens
   *  that folder; the parent should clear via `onPendingFolderConsumed`. */
  pendingFolderId?: number | null;
  onPendingFolderConsumed?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MyLibrary({
  userDocs,
  isUploading,
  uploadError,
  onUploadFile,
  onSelectDocument,
  onSelectSession,
  onStartNewSession,
  onDeleteRequest,
  onStarDocument,
  onMoveDocument,
  folders,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  personas,
  onOpenSessionsSearch,
  pendingFolderId,
  onPendingFolderConsumed,
}: MyLibraryProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const createMenuRef                         = useRef<HTMLDivElement>(null);

  const [createMenuOpen, setCreateMenuOpen]   = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder]     = useState<Folder | null>(null);

  // Drilldown — when set we're viewing the contents of a Folder or a Course.
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);

  const [sessions, setSessions]     = useState<SessionRow[]>([]);
  const [moveDoc, setMoveDoc]       = useState<Doc | null>(null);
  // F-031 / T-013: courses for the FolderModal picker so users can attach
  // a folder to a course straight from My Library. Self-contained fetch
  // to avoid threading another prop through App.tsx.
  const [courseOptions, setCourseOptions] = useState<{ id: number; title: string }[]>([]);

  // ── Click-outside for the +New menu ─────────────────────────────────────
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Fetch lanes ───────────────────────────────────────────────────────────
  // Three-lane restructure (2026-05-08): Sessions and Files are independent
  // lanes — a doc with conversations shows up in BOTH (Files for the doc
  // itself, Sessions for the chat tree on top of it).
  const refreshSessions = async () => {
    try {
      const res = await api.listSessions();
      setSessions(res.data);
    } catch (err) {
      console.error('[MyLibrary] failed to load sessions', err);
    }
  };

  // userDocs.length triggers a refresh on upload/delete; threads created
  // from `useChat` are picked up by the next mount or page navigation.
  useEffect(() => { void refreshSessions(); }, [userDocs.length]);

  // Load the user's owned/admin/starred courses once for the FolderModal
  // picker. Failure is non-fatal — modal just hides the picker.
  useEffect(() => {
    api.listCourses()
      .then(res => setCourseOptions(res.data.map((c: any) => ({ id: c.id, title: c.title }))))
      .catch(err => console.error('[MyLibrary] failed to load course options', err));
  }, []);

  // Files lane — sort by recency-of-use (last_opened_at, fallback
  // created_at) descending so the doc the user just opened jumps to the
  // front. Exam / syllabus source files are excluded server-side
  // by GET /api/v1/documents/ (B-014) — no frontend filter needed.
  const sortedFiles = useMemo(() => {
    return [...userDocs].sort((a, b) => {
      const ta = a.last_opened_at ?? a.created_at ?? '';
      const tb = b.last_opened_at ?? b.created_at ?? '';
      return tb.localeCompare(ta);
    });
  }, [userDocs]);

  // ── Cross-page folder drilldown ─────────────────────────────────────────
  // When the user clicks a folder card inside a course's Folders tab on the
  // Courses page, the parent navigates to view='main' and sets
  // `pendingFolderId`. Pick it up and drill in. Course drilldown moved out
  // entirely — see CoursesPage for that.
  useEffect(() => {
    if (pendingFolderId == null) return;
    setActiveFolderId(pendingFolderId);
    onPendingFolderConsumed?.();
  }, [pendingFolderId]);

  // ── Drilldown helpers ────────────────────────────────────────────────────
  const activeFolder = activeFolderId != null
    ? folders.find(f => f.id === activeFolderId) ?? null
    : null;

  const visibleDocs = useMemo(() => {
    if (activeFolderId != null) {
      return userDocs.filter(d => d.folder_id === activeFolderId);
    }
    return [];
  }, [userDocs, activeFolderId]);

  const topLevelFolders = useMemo(
    () => folders.filter(f => f.course_id == null),
    [folders],
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  function openFolder(id: number) {
    setActiveFolderId(id);
  }
  function backToRoot() {
    setActiveFolderId(null);
  }

  function openCreate(kind: CreateMenu) {
    setCreateMenuOpen(false);
    if (kind === 'session')    onStartNewSession();
    else if (kind === 'folder') { setEditingFolder(null); setFolderModalOpen(true); }
  }

  async function handleDeleteSession(sessionId: number) {
    if (!confirm('Delete this session and its branches?')) return;
    try {
      await api.deleteSession(sessionId);
      await refreshSessions();
    } catch (err) {
      console.error('[deleteSession]', err);
      alert('Failed to delete session.');
    }
  }

  // ── Header ───────────────────────────────────────────────────────────────
  // Auto-summarize toggle removed (F-021) per user feedback — uploads no
  // longer trigger a full-doc Gemini summary at upload time. Per-page +
  // on-demand summaries still live inside the chat panel's Summary tab.
  const headerActions = (
    <>
      <label
        className={`flex items-center gap-2 bg-white hover:bg-[#F7F7F5] text-[#37352F] text-sm font-medium px-3 py-2 rounded-lg border border-[#E8E8E6] transition-colors duration-150 cursor-pointer ${
          isUploading ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''
        }`}
      >
        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {isUploading ? 'Uploading…' : 'Upload file'}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={onUploadFile}
          disabled={isUploading}
        />
      </label>

      {/* + New (session / folder / course) — the dropdown the user asked for */}
      <div ref={createMenuRef} className="relative">
        <button
          onClick={() => setCreateMenuOpen(v => !v)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          New
        </button>
        {createMenuOpen && (
          <div className="absolute top-full mt-1 right-0 w-56 bg-white rounded-lg border border-[#E8E8E6] shadow-lg z-50 overflow-hidden">
            <button
              onClick={() => openCreate('session')}
              className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-[#F7F7F5] text-start"
            >
              <MessageSquare className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#37352F]">New Session</p>
                <p className="text-[10px] text-[#787774]">Start a chat — no document needed</p>
              </div>
            </button>
            <button
              onClick={() => openCreate('folder')}
              className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-[#F7F7F5] text-start border-t border-[#E8E8E6]"
            >
              <FolderPlus className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#37352F]">New Folder</p>
                <p className="text-[10px] text-[#787774]">Group documents and sessions</p>
              </div>
            </button>
            {/* "New Course" lives on the dedicated Courses page now (sidebar
                → Courses → My Courses tab). The +New menu in My Library
                stays focused on session + folder. */}
          </div>
        )}
      </div>
    </>
  );

  // ── Drilldown (folder OR course) ─────────────────────────────────────────
  if (activeFolder) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 mb-5">
          <button onClick={backToRoot} className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F]">
            <ArrowLeft className="w-4 h-4" /> My Library
          </button>
          <span className="text-[#C4C4C4]">/</span>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: activeFolder.color ?? '#6366F1' }} />
            <span className="text-sm font-semibold text-[#37352F]">{activeFolder.name}</span>
          </div>
        </div>

        {visibleDocs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-[#787774]">
            <FolderOpen className="w-8 h-8 opacity-30" />
            <p className="text-sm">This folder is empty.</p>
            <label className="mt-1 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
              <Upload className="w-4 h-4" />
              Upload a document
              <input type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={onUploadFile} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleDocs.map(doc => (
              <div
                key={doc.id}
                onClick={() => onSelectDocument({ id: doc.id })}
                className="group bg-white border border-[#E8E8E6] rounded-xl p-4 cursor-pointer hover:border-[#C4C4C4] hover:shadow-sm transition-all duration-150 flex items-start gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                  <FileIcon filename={doc.title} className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#37352F] truncate">{doc.title}</p>
                  {doc.summary && <p className="text-xs text-[#787774] line-clamp-2 mt-1">{doc.summary}</p>}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onStarDocument(doc.id, !doc.is_starred); }}
                  className="p-1 rounded-md hover:bg-amber-50"
                  title={doc.is_starred ? 'Remove star' : 'Star'}
                >
                  <Star className={`w-4 h-4 ${doc.is_starred ? 'text-amber-400 fill-amber-400' : 'text-[#C4C4C4]'}`} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setMoveDoc(doc); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[#C4C4C4] hover:text-indigo-600 hover:bg-indigo-50"
                  title="Move to…"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteRequest(doc); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[#C4C4C4] hover:text-red-500 hover:bg-red-50"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <MoveToFolderModal
          isOpen={!!moveDoc}
          docTitle={moveDoc?.title ?? ''}
          folders={folders}
          currentFolderId={moveDoc?.folder_id ?? null}
          onMove={folderId => moveDoc && onMoveDocument(moveDoc.id, folderId)}
          onClose={() => setMoveDoc(null)}
        />
      </PageContainer>
    );
  }

  // Course drilldown moved to the dedicated Courses page (CoursesPage). My
  // Library now only owns Sessions / Files / Folders + the folder-drilldown
  // branch above. The cross-page folder drilldown lands via `pendingFolderId`.

  // ── Root view: lanes ─────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="My Library"
        subtitle="Your sessions, files, and folders. Courses live on their own page."
        icon={<Library className="w-5 h-5 text-indigo-600" />}
        actions={headerActions}
      />

      {/* Upload status banners */}
      {uploadError === 'DOCUMENT_EXISTS' && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-xl text-sm text-sky-900 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="font-semibold text-sky-900">Already in your library</p>
            <p className="text-sky-700 mt-0.5 text-xs leading-relaxed">
              This document is already in your library — no need to upload it again!
            </p>
          </div>
        </div>
      )}
      {uploadError && uploadError !== 'DOCUMENT_EXISTS' && (
        <div className="mb-6 flex items-start gap-2.5 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Upload failed. Please check the file and try again.</span>
        </div>
      )}

      {/* ── Lane 1: Sessions (only — files are their own lane below) ─────── */}
      <LibraryLane
        title="Sessions"
        count={sessions.length}
        onSearchClick={onOpenSessionsSearch}
        isEmpty={sessions.length === 0}
        emptyState={
          <div className="flex flex-col items-center gap-2 text-[#787774]">
            <MessageSquare className="w-7 h-7 opacity-30" />
            <p className="text-sm">No sessions yet — start one with the “+ New Session” button on the left.</p>
            <button
              onClick={onStartNewSession}
              className="mt-1 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              Start a session
            </button>
          </div>
        }
      >
        {sessions.map(s => (
          <SessionCard
            key={`s${s.id}`}
            session={{
              session_id:     s.id,
              // Prefer the AI-generated collective title; fall back to the
              // per-thread short label, then to a generic placeholder.
              session_title:  s.session_title ?? s.title,
              session_emoji:  s.emoji,
              session_preview: s.last_message,
              message_count:  s.message_count,
              document_id:    s.document_id,
              document_title: s.document_title,
              sort_at:        s.created_at,
            }}
            onOpen={onSelectSession}
            onDelete={handleDeleteSession}
          />
        ))}
      </LibraryLane>

      {/* ── Lane 2: Files (every doc, sorted by last opened) ─────────────── */}
      <LibraryLane
        title="Files"
        count={sortedFiles.length}
        isEmpty={sortedFiles.length === 0}
        emptyState={
          <div className="flex flex-col items-center gap-2 text-[#787774]">
            <FileText className="w-7 h-7 opacity-30" />
            <p className="text-sm">No files yet — upload one with the button above.</p>
          </div>
        }
      >
        {sortedFiles.map(doc => (
          <FileCardCompact
            key={`f${doc.id}`}
            file={{
              file_id:       doc.id,
              file_title:    doc.title,
              file_doc_type: doc.doc_type ?? 'GENERAL',
              is_starred:    doc.is_starred,
              is_public:     doc.is_public,
            }}
            sortAt={doc.last_opened_at ?? doc.created_at ?? undefined}
            onOpen={id => onSelectDocument({ id })}
            onDelete={(id, title) => onDeleteRequest({ id, title })}
            onStar={(id, isStarred) => onStarDocument(id, isStarred)}
          />
        ))}
      </LibraryLane>

      {/* ── Lane 3: Folders (top-level only) ─────────────────────────────── */}
      <LibraryLane
        title="Folders"
        count={topLevelFolders.length}
        isEmpty={topLevelFolders.length === 0}
        emptyState={
          <div className="flex flex-col items-center gap-2 text-[#787774]">
            <FolderPlus className="w-7 h-7 opacity-30" />
            <p className="text-sm">No folders yet.</p>
            <button
              onClick={() => { setEditingFolder(null); setFolderModalOpen(true); }}
              className="mt-1 flex items-center gap-2 bg-white text-[#37352F] hover:bg-[#F7F7F5] text-sm font-medium px-4 py-2 rounded-lg border border-[#E8E8E6]"
            >
              <FolderPlus className="w-4 h-4" />
              New folder
            </button>
          </div>
        }
      >
        {topLevelFolders.map(folder => (
          <div key={folder.id} className="shrink-0 w-64">
            <FolderCard
              folder={folder}
              docCount={userDocs.filter(d => d.folder_id === folder.id).length}
              personaName={folder.persona_id ? personas.find(p => p.id === folder.persona_id)?.name : undefined}
              onOpen={openFolder}
              onEdit={f => { setEditingFolder(f); setFolderModalOpen(true); }}
              onDelete={f => onDeleteFolder(f.id)}
            />
          </div>
        ))}
      </LibraryLane>

      {/* Courses are not a My Library lane — they live on the dedicated
          Courses page now (sidebar → Courses, two-tab My / Public layout). */}

      {/* Folder modal — courses prop drives the optional course picker
          (T-013 / F-031). When the courses fetch failed the picker is
          gracefully hidden. */}
      <FolderModal
        isOpen={folderModalOpen}
        editing={editingFolder}
        personas={personas}
        courses={courseOptions}
        onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        onSave={async payload => {
          if (editingFolder) {
            await onUpdateFolder(editingFolder.id, payload);
          } else {
            await onCreateFolder(payload);
          }
        }}
      />

      {/* Course create / edit modal moved to the Courses page. */}
    </PageContainer>
  );
}
