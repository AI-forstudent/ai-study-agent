import { useState } from 'react';
import {
  ArrowLeft, FolderOpen, FileText, GraduationCap, MessageSquare, Mic,
  Settings as SettingsIcon, AlertTriangle, Trash2, Loader2, Plus,
} from 'lucide-react';
import PageContainer from '../../../components/layout/PageContainer';
import FolderCard from '../../documents/components/FolderCard';
import CourseSyllabusTab from './CourseSyllabusTab';
import CourseExamsTab from './CourseExamsTab';
import CourseLecturesTab from './CourseLecturesTab';
import FolderModal from '../../documents/components/FolderModal';
import type { Course } from '../../../types/course';
import type { Folder } from '../../documents/hooks/useFolders';
import type { Persona } from '../../../types/persona';

type CourseTab = 'content' | 'syllabus' | 'exams' | 'settings';

interface Doc {
  id:        number;
  folder_id: number | null;
}

interface CourseDetailViewProps {
  course:               Course;
  folders:              Folder[];
  userDocs:             Doc[];
  personas:             Persona[];
  onBack:               () => void;
  onEdit:               (course: Course) => void;
  /** Hard-deletes the course after the typed-confirmation in the Danger
   *  Zone. Caller is responsible for closing this view + refreshing the
   *  course list once the deletion succeeds (see CoursesPage). */
  onDelete:             (course: Course) => Promise<void>;
  onStartCourseChat:    (courseId: number) => void;
  /** Cross-page navigation to My Library with this folder drilled in.
   *  Edit / delete folder actions are deliberately not exposed here in
   *  commit 3 — those happen in My Library's folder view. */
  onOpenFolderInLibrary: (folderId: number) => void;
  /** Create a new folder. Caller wires this through useFolders. The
   *  Folders tab passes `course_id` set to this course's id automatically. */
  onCreateFolder?: (p: {
    name: string; color: string | null; is_starred: boolean;
    persona_id: string | null; course_id: number | null;
  }) => Promise<Folder>;
  /** F-036: open a lecture in MainWorkspace as a real session. Bubbles
   *  up from CourseLecturesTab. */
  onOpenLecture?: (lecture: any) => void;
}

/**
 * Course detail view — extracted from MyLibrary into the dedicated Courses
 * page (per the 2026-05-08 library restructure brief). Renders four tabs
 * inside a course: Folders / Lectures / Syllabus / Exams (+ Settings/Danger
 * Zone for owners). Lectures landed in F-031 Phase 1.
 */
export default function CourseDetailView({
  course,
  folders,
  userDocs,
  personas,
  onBack,
  onEdit,
  onDelete,
  onStartCourseChat,
  onOpenFolderInLibrary,
  onCreateFolder,
  onOpenLecture,
}: CourseDetailViewProps) {
  const [tab, setTab] = useState<CourseTab>('content');
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const accent = course.color ?? '#6366F1';
  const isOwner = course.role === 'owner';

  const courseFolders = folders.filter(f => f.course_id === course.id);

  // ── Danger-zone delete state (typed confirmation) ─────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting]           = useState(false);
  const [deleteError, setDeleteError]     = useState<string | null>(null);
  const deleteUnlocked = deleteConfirm.trim() === course.title;

  async function handleDelete() {
    if (!deleteUnlocked || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(course);
      // Parent (CoursesPage) is responsible for navigating away — if it
      // doesn't, the user just sees the Danger Zone clear back to idle.
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail ?? 'Failed to delete course.');
      setDeleting(false);
    }
  }

  return (
    <PageContainer>
      {/* ── Breadcrumb + actions — stack on phone, side-by-side on tablet+ ─ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F] shrink-0">
            <ArrowLeft className="w-4 h-4" /> Courses
          </button>
          <span className="text-[#C4C4C4]">/</span>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: accent }} />
            <span className="text-sm font-semibold text-[#37352F] truncate">{course.title}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onStartCourseChat(course.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
            title="Open a chat that knows this course's syllabus"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="sm:hidden">Chat</span>
            <span className="hidden sm:inline">Chat about this course</span>
          </button>
          {isOwner && (
            <button
              onClick={() => onEdit(course)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#787774] border border-[#E8E8E6] rounded-lg hover:bg-[#F7F7F5]"
            >
              Edit course
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs — scroll horizontally if they overflow ───────────────── */}
      <div className="flex border-b border-[#E8E8E6] mb-5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        <button
          onClick={() => setTab('content')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 whitespace-nowrap shrink-0 ${
            tab === 'content'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          Lectures & Files
        </button>
        <button
          onClick={() => setTab('syllabus')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 whitespace-nowrap shrink-0 ${
            tab === 'syllabus'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Syllabus
        </button>
        <button
          onClick={() => setTab('exams')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 whitespace-nowrap shrink-0 ${
            tab === 'exams'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          Exams
        </button>
        {isOwner && (
          <button
            onClick={() => setTab('settings')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 whitespace-nowrap shrink-0 ${
              tab === 'settings'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-[#787774] hover:text-[#37352F]'
            }`}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Settings
          </button>
        )}
      </div>

      {/* ── Tab body ─────────────────────────────────────────────────── */}
      {/* F-036.1 — merged "Lectures & Files" tab: lecture cards on top,
                   course folders below, all in the same view. */}
      {tab === 'content' && (
        <div className="space-y-6">
          <CourseLecturesTab courseId={course.id} isOwner={isOwner} onOpenLecture={onOpenLecture} />

          <div className="space-y-3 pt-2 border-t border-[#E8E8E6]">
            <div className="flex items-center justify-between gap-3 pt-3">
              <div>
                <h2 className="text-base font-semibold text-[#37352F]">
                  Folders <span className="text-sm font-normal text-[#C4C4C4]">({courseFolders.length})</span>
                </h2>
                <p className="text-xs text-[#787774] mt-0.5">
                  Files grouped into folders. Click a folder to open it in My Library.
                </p>
              </div>
              {isOwner && onCreateFolder && (
                <button
                  onClick={() => setFolderModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Add folder
                </button>
              )}
            </div>
            {courseFolders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-[#787774]">
                <FolderOpen className="w-7 h-7 opacity-30" />
                <p className="text-sm">No folders yet.</p>
                <p className="text-xs text-[#C4C4C4]">
                  {isOwner
                    ? 'Use “Add folder” above, or assign an existing folder from My Library.'
                    : 'The course owner has not added any folders yet.'}
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
                    onOpen={onOpenFolderInLibrary}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'syllabus' && (
        <CourseSyllabusTab courseId={course.id} isOwner={isOwner} />
      )}

      {tab === 'exams' && (
        <CourseExamsTab courseId={course.id} isOwner={isOwner} />
      )}

      {/* Folder modal — opened from the "+ Add folder" button on the
          Folders tab. The course is locked to this course's id so the
          new folder lands inside it without an extra picker. */}
      {onCreateFolder && (
        <FolderModal
          isOpen={folderModalOpen}
          editing={null}
          personas={personas}
          defaultCourseId={course.id}
          lockCourse
          onClose={() => setFolderModalOpen(false)}
          onSave={async payload => { await onCreateFolder(payload); }}
        />
      )}

      {tab === 'settings' && isOwner && (
        <div className="max-w-2xl space-y-6">
          {/* General — read-only summary that points at the existing edit modal. */}
          <section className="bg-white border border-[#E8E8E6] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-[#37352F] mb-1">General</h3>
            <p className="text-xs text-[#787774] mb-4">
              Title, description, color, icon, and visibility are edited from the
              "Edit course" button in the page header.
            </p>
            <button
              onClick={() => onEdit(course)}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              Open edit dialog →
            </button>
          </section>

          {/* Danger Zone — typed confirmation, red affordance. F-024. */}
          <section className="border border-red-200 rounded-xl bg-red-50/30">
            <header className="flex items-center gap-2 px-5 py-3 border-b border-red-200 bg-red-50/60 rounded-t-xl">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-semibold text-red-700">Danger Zone</h3>
            </header>
            <div className="p-5 space-y-3">
              <div>
                <p className="text-sm font-medium text-[#37352F]">Delete this course</p>
                <p className="text-xs text-[#787774] mt-1 leading-relaxed">
                  Folders inside this course become top-level folders in your
                  library — no documents or threads are deleted. Memberships
                  pointing at this course are removed. This cannot be undone.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-[#787774] block mb-1">
                  Type the course title to confirm: <span className="font-mono text-[#37352F]">{course.title}</span>
                </label>
                <input
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder={course.title}
                  className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                  disabled={deleting}
                />
              </div>

              {deleteError && (
                <p className="text-xs text-red-600">{deleteError}</p>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleDelete}
                  disabled={!deleteUnlocked || deleting}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed rounded-lg transition-colors duration-150"
                >
                  {deleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Delete this course
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
