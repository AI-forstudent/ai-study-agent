import { useState } from 'react';
import {
  ArrowLeft, FolderOpen, FileText, GraduationCap, MessageSquare,
} from 'lucide-react';
import PageContainer from '../../../components/layout/PageContainer';
import FolderCard from '../../documents/components/FolderCard';
import CourseSyllabusTab from './CourseSyllabusTab';
import CourseExamsTab from './CourseExamsTab';
import type { Course } from '../../../types/course';
import type { Folder } from '../../documents/hooks/useFolders';
import type { Persona } from '../../../types/persona';

type CourseTab = 'folders' | 'syllabus' | 'exams';

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
  onStartCourseChat:    (courseId: number) => void;
  /** Cross-page navigation to My Library with this folder drilled in.
   *  Edit / delete folder actions are deliberately not exposed here in
   *  commit 3 — those happen in My Library's folder view. */
  onOpenFolderInLibrary: (folderId: number) => void;
}

/**
 * Course detail view — extracted from MyLibrary into the dedicated Courses
 * page (per the 2026-05-08 library restructure brief). Renders three tabs
 * inside a course: Folders / Syllabus / Exams. The Settings → Danger Zone
 * tab lands in commit 4 (F-024).
 */
export default function CourseDetailView({
  course,
  folders,
  userDocs,
  personas,
  onBack,
  onEdit,
  onStartCourseChat,
  onOpenFolderInLibrary,
}: CourseDetailViewProps) {
  const [tab, setTab] = useState<CourseTab>('folders');
  const accent = course.color ?? '#6366F1';
  const isOwner = course.role === 'owner';

  const courseFolders = folders.filter(f => f.course_id === course.id);

  return (
    <PageContainer>
      {/* ── Breadcrumb + actions ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F]">
            <ArrowLeft className="w-4 h-4" /> Courses
          </button>
          <span className="text-[#C4C4C4]">/</span>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: accent }} />
            <span className="text-sm font-semibold text-[#37352F]">{course.title}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStartCourseChat(course.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
            title="Open a chat that knows this course's syllabus"
          >
            <MessageSquare className="w-4 h-4" />
            Chat about this course
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

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex border-b border-[#E8E8E6] mb-5">
        <button
          onClick={() => setTab('folders')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
            tab === 'folders'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Folders
          <span className="text-[10px] text-[#C4C4C4]">({courseFolders.length})</span>
        </button>
        <button
          onClick={() => setTab('syllabus')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
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
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
            tab === 'exams'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          Exams
        </button>
      </div>

      {/* ── Tab body ─────────────────────────────────────────────────── */}
      {tab === 'folders' && (
        courseFolders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-[#787774]">
            <FolderOpen className="w-8 h-8 opacity-30" />
            <p className="text-sm">This course has no folders yet.</p>
            <p className="text-xs text-[#C4C4C4]">
              Create a folder from the library and assign it to this course.
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
        )
      )}

      {tab === 'syllabus' && (
        <CourseSyllabusTab courseId={course.id} isOwner={isOwner} />
      )}

      {tab === 'exams' && (
        <CourseExamsTab courseId={course.id} isOwner={isOwner} />
      )}
    </PageContainer>
  );
}
