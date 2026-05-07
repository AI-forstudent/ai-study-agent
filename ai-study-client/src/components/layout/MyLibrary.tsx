import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, Library, Loader2, AlertCircle, CheckCircle2,
  Plus, FolderPlus, GraduationCap, MessageSquare, ArrowLeft,
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
import CourseCard from '../../features/courses/components/CourseCard';
import CourseModal from '../../features/courses/components/CourseModal';
import CourseSyllabusTab from '../../features/courses/components/CourseSyllabusTab';
import CourseExamsTab from '../../features/courses/components/CourseExamsTab';
import type { Folder } from '../../features/documents/hooks/useFolders';
import type { Persona } from '../../types/persona';
import type { Course, LibraryFeedItem } from '../../types/course';
import { ACCEPTED_FILE_TYPES, FileIcon } from '../../utils/fileIcons';
import { api } from '../../services/api';

type CreateMenu = 'session' | 'folder' | 'course';

interface Doc {
  id: number;
  title: string;
  summary: string | null;
  is_public: boolean;
  is_starred: boolean;
  folder_id: number | null;
  shared_at: string | null;
  created_at?: string | null;
  doc_type?: string;
  file_path?: string;
}

interface MyLibraryProps {
  userDocs: Doc[];
  isUploading: boolean;
  uploadError: string | null;
  enableGlobalSummary: boolean;
  setEnableGlobalSummary: (val: boolean) => void;
  onUploadFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectDocument: (doc: { id: number }) => void;
  onSelectSession: (sessionId: number) => void;
  onStartNewSession: () => void;
  /** Start a new chat session scoped to a specific course (its syllabus
   *  becomes part of the AI Teacher's system prompt). */
  onStartCourseChat: (courseId: number) => void;
  onDeleteRequest: (doc: { id: number; title: string }) => void;
  onStarDocument: (id: number, isStarred: boolean) => void;
  onMoveDocument: (docId: number, folderId: number | null) => void;
  folders: Folder[];
  onCreateFolder: (p: { name: string; color: string | null; is_starred: boolean; persona_id: string | null }) => Promise<Folder>;
  onUpdateFolder: (id: number, p: { name?: string; color?: string | null; is_starred?: boolean; persona_id?: string | null }) => Promise<Folder>;
  onDeleteFolder: (id: number) => Promise<void>;
  personas: Persona[];
  /** Navigate to the dedicated Sessions search page. */
  onOpenSessionsSearch?: () => void;
  /** When set (e.g. after the user clicks a public course card), MyLibrary
   *  refreshes its course list and drills into this course. The parent should
   *  clear it via `onPendingCourseConsumed` so the same course id can be opened
   *  again later. */
  pendingCourseId?: number | null;
  onPendingCourseConsumed?: () => void;
}

type CourseTab = 'folders' | 'syllabus' | 'exams';

// ── Main component ────────────────────────────────────────────────────────────

export default function MyLibrary({
  userDocs,
  isUploading,
  uploadError,
  enableGlobalSummary,
  setEnableGlobalSummary,
  onUploadFile,
  onSelectDocument,
  onSelectSession,
  onStartNewSession,
  onStartCourseChat,
  onDeleteRequest,
  onStarDocument,
  onMoveDocument,
  folders,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  personas,
  onOpenSessionsSearch,
  pendingCourseId,
  onPendingCourseConsumed,
}: MyLibraryProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const createMenuRef                         = useRef<HTMLDivElement>(null);

  const [createMenuOpen, setCreateMenuOpen]   = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder]     = useState<Folder | null>(null);
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse]     = useState<Course | null>(null);

  // Drilldown — when set we're viewing the contents of a Folder or a Course.
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const [courseTab, setCourseTab]           = useState<CourseTab>('folders');

  const [recentFeed, setRecentFeed] = useState<LibraryFeedItem[]>([]);
  const [courses, setCourses]       = useState<Course[]>([]);
  const [moveDoc, setMoveDoc]       = useState<Doc | null>(null);

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
  const refreshFeed = async () => {
    try {
      const res = await api.getLibraryRecent();
      setRecentFeed(res.data);
    } catch (err) {
      console.error('[MyLibrary] failed to load recent feed', err);
    }
  };
  const refreshCourses = async () => {
    try {
      const res = await api.listCourses();
      setCourses(res.data);
    } catch (err) {
      console.error('[MyLibrary] failed to load courses', err);
    }
  };

  useEffect(() => { void refreshFeed(); }, [userDocs.length]);
  useEffect(() => { void refreshCourses(); }, []);

  // ── Drill into a course requested by the parent (e.g. clicked from the
  //    Public Courses page). We refresh "My Courses" first; if the requested
  //    course isn't there (public-course click without a star), we fetch it
  //    directly via getCourse and inject it into the local list so the
  //    drilldown UI can resolve `activeCourse`. The course's `role` field
  //    will be null for a non-member, which the detail view already uses to
  //    hide owner-only actions like "Edit course".
  useEffect(() => {
    if (pendingCourseId == null) return;
    let cancelled = false;
    (async () => {
      let freshCourses: Course[] = [];
      try {
        const res = await api.listCourses();
        freshCourses = res.data;
      } catch (err) {
        console.error('[MyLibrary] failed to load courses', err);
      }
      if (cancelled) return;

      let resolvable = freshCourses.some(c => c.id === pendingCourseId);
      if (!resolvable) {
        try {
          const res = await api.getCourse(pendingCourseId);
          freshCourses = [...freshCourses, res.data];
          resolvable = true;
        } catch (err) {
          console.error('[MyLibrary] could not load pending course', err);
        }
      }
      if (cancelled) return;

      setCourses(freshCourses);
      if (resolvable) {
        setActiveCourseId(pendingCourseId);
        setActiveFolderId(null);
        setCourseTab('folders');
      }
      onPendingCourseConsumed?.();
    })();
    return () => { cancelled = true; };
  }, [pendingCourseId]);

  // ── Drilldown helpers ────────────────────────────────────────────────────
  const activeFolder = activeFolderId != null
    ? folders.find(f => f.id === activeFolderId) ?? null
    : null;
  const activeCourse = activeCourseId != null
    ? courses.find(c => c.id === activeCourseId) ?? null
    : null;

  const visibleDocs = useMemo(() => {
    if (activeFolderId != null) {
      return userDocs.filter(d => d.folder_id === activeFolderId);
    }
    return [];
  }, [userDocs, activeFolderId]);

  const courseFolders = useMemo(() => {
    if (activeCourseId == null) return [];
    return folders.filter(f => f.course_id === activeCourseId);
  }, [folders, activeCourseId]);

  const topLevelFolders = useMemo(
    () => folders.filter(f => f.course_id == null),
    [folders],
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  function openFolder(id: number) {
    setActiveFolderId(id);
    setActiveCourseId(null);
  }
  function openCourse(id: number) {
    setActiveCourseId(id);
    setActiveFolderId(null);
    setCourseTab('folders');
  }
  function backToRoot() {
    setActiveFolderId(null);
    setActiveCourseId(null);
  }

  function openCreate(kind: CreateMenu) {
    setCreateMenuOpen(false);
    if (kind === 'session')    onStartNewSession();
    else if (kind === 'folder') { setEditingFolder(null); setFolderModalOpen(true); }
    else if (kind === 'course') { setEditingCourse(null); setCourseModalOpen(true); }
  }

  async function handleDeleteSession(sessionId: number) {
    if (!confirm('Delete this session and its branches?')) return;
    try {
      await api.deleteSession(sessionId);
      await refreshFeed();
    } catch (err) {
      console.error('[deleteSession]', err);
      alert('Failed to delete session.');
    }
  }

  // ── Header ───────────────────────────────────────────────────────────────
  const headerActions = (
    <>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <div className="relative">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enableGlobalSummary}
            onChange={e => setEnableGlobalSummary(e.target.checked)}
          />
          <div className="w-8 h-4 bg-[#E8E8E6] rounded-full peer peer-checked:bg-indigo-600 transition-colors duration-150" />
          <div className="absolute top-0.5 start-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-150 peer-checked:translate-x-4" />
        </div>
        <span className="text-xs text-[#787774]">Auto-summarize</span>
      </label>

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
            <button
              onClick={() => openCreate('course')}
              className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-[#F7F7F5] text-start border-t border-[#E8E8E6]"
            >
              <GraduationCap className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-[#37352F]">New Course</p>
                <p className="text-[10px] text-[#787774]">Top-level container for folders</p>
              </div>
            </button>
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

  if (activeCourse) {
    const courseAccent = activeCourse.color ?? '#6366F1';
    const isOwner = activeCourse.role === 'owner';

    return (
      <PageContainer>
        {/* Breadcrumb + actions */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <button onClick={backToRoot} className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F]">
              <ArrowLeft className="w-4 h-4" /> My Library
            </button>
            <span className="text-[#C4C4C4]">/</span>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: courseAccent }} />
              <span className="text-sm font-semibold text-[#37352F]">{activeCourse.title}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onStartCourseChat(activeCourse.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
              title="Open a chat that knows this course's syllabus"
            >
              <MessageSquare className="w-4 h-4" />
              Chat about this course
            </button>
            {isOwner && (
              <button
                onClick={() => { setEditingCourse(activeCourse); setCourseModalOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#787774] border border-[#E8E8E6] rounded-lg hover:bg-[#F7F7F5]"
              >
                Edit course
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#E8E8E6] mb-5">
          <button
            onClick={() => setCourseTab('folders')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
              courseTab === 'folders'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-[#787774] hover:text-[#37352F]'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Folders
            <span className="text-[10px] text-[#C4C4C4]">({courseFolders.length})</span>
          </button>
          <button
            onClick={() => setCourseTab('syllabus')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
              courseTab === 'syllabus'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-[#787774] hover:text-[#37352F]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Syllabus
          </button>
          <button
            onClick={() => setCourseTab('exams')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
              courseTab === 'exams'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-[#787774] hover:text-[#37352F]'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            Exams
          </button>
        </div>

        {/* Tab body */}
        {courseTab === 'folders' && (
          courseFolders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-[#787774]">
              <FolderOpen className="w-8 h-8 opacity-30" />
              <p className="text-sm">This course has no folders yet.</p>
              <p className="text-xs text-[#C4C4C4]">
                Create a folder from the library and assign it to this course (folder→course move comes next).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {courseFolders.map(folder => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  docCount={userDocs.filter(d => d.folder_id === folder.id).length}
                  personaName={folder.persona_id ? personas.find(p => p.id === folder.persona_id)?.name : undefined}
                  onOpen={openFolder}
                  onEdit={f => { setEditingFolder(f); setFolderModalOpen(true); }}
                  onDelete={f => onDeleteFolder(f.id)}
                />
              ))}
            </div>
          )
        )}

        {courseTab === 'syllabus' && (
          <CourseSyllabusTab courseId={activeCourse.id} isOwner={isOwner} />
        )}

        {courseTab === 'exams' && (
          <CourseExamsTab courseId={activeCourse.id} isOwner={isOwner} />
        )}
      </PageContainer>
    );
  }

  // ── Root view: lanes ─────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="My Library"
        subtitle="Sessions, files, folders, and courses — everything in one place."
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

      {/* ── Lane 1: Sessions & Files (mixed) ────────────────────────────── */}
      <LibraryLane
        title="Sessions & Files"
        count={recentFeed.length}
        onSearchClick={onOpenSessionsSearch}
        isEmpty={recentFeed.length === 0}
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
        {recentFeed.map(item =>
          item.kind === 'session' ? (
            <SessionCard
              key={`s${item.session_id}`}
              session={item}
              onOpen={onSelectSession}
              onDelete={handleDeleteSession}
            />
          ) : (
            <FileCardCompact
              key={`f${item.file_id}`}
              file={item}
              sortAt={item.sort_at}
              onOpen={id => onSelectDocument({ id })}
              onDelete={(id, title) => onDeleteRequest({ id, title })}
              onStar={(id, isStarred) => onStarDocument(id, isStarred)}
            />
          ),
        )}
      </LibraryLane>

      {/* ── Lane 2: Folders (top-level only) ─────────────────────────────── */}
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

      {/* ── Lane 3: My Courses ────────────────────────────────────────────── */}
      <LibraryLane
        title="My Courses"
        count={courses.length}
        isEmpty={courses.length === 0}
        emptyState={
          <div className="flex flex-col items-center gap-2 text-[#787774]">
            <GraduationCap className="w-7 h-7 opacity-30" />
            <p className="text-sm">No courses yet.</p>
            <button
              onClick={() => { setEditingCourse(null); setCourseModalOpen(true); }}
              className="mt-1 flex items-center gap-2 bg-white text-[#37352F] hover:bg-[#F7F7F5] text-sm font-medium px-4 py-2 rounded-lg border border-[#E8E8E6]"
            >
              <GraduationCap className="w-4 h-4" />
              New course
            </button>
          </div>
        }
      >
        {courses.map(course => (
          <CourseCard
            key={course.id}
            course={course}
            onOpen={openCourse}
            onEdit={c => { setEditingCourse(c); setCourseModalOpen(true); }}
            onDelete={async c => {
              if (!confirm(`Delete "${c.title}"?`)) return;
              try {
                await api.deleteCourse(c.id);
                await refreshCourses();
              } catch (err) {
                console.error('[deleteCourse]', err);
                alert('Failed to delete course.');
              }
            }}
          />
        ))}
      </LibraryLane>

      {/* Folder modal */}
      <FolderModal
        isOpen={folderModalOpen}
        editing={editingFolder}
        personas={personas}
        onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        onSave={async payload => {
          if (editingFolder) {
            await onUpdateFolder(editingFolder.id, payload);
          } else {
            await onCreateFolder(payload);
          }
        }}
      />

      {/* Course modal */}
      <CourseModal
        isOpen={courseModalOpen}
        editing={editingCourse}
        onClose={() => { setCourseModalOpen(false); setEditingCourse(null); }}
        onSaved={async () => { await refreshCourses(); }}
        onDeleted={async () => { await refreshCourses(); }}
      />
    </PageContainer>
  );
}
