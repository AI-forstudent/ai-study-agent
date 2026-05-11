import { useEffect, useState } from 'react';
import { GraduationCap, Globe, Loader2 } from 'lucide-react';
import PageContainer from '../../../components/layout/PageContainer';
import PageHeader from '../../../components/layout/PageHeader';
import MyCoursesTab from './MyCoursesTab';
import PublicCoursesPage from './PublicCoursesPage';
import CourseDetailView from './CourseDetailView';
import CourseModal from './CourseModal';
import type { Course, PublicCourse } from '../../../types/course';
import type { Folder } from '../../documents/hooks/useFolders';
import type { Persona } from '../../../types/persona';
import { api } from '../../../services/api';

type CoursesTab = 'my' | 'public';

interface Doc {
  id:        number;
  folder_id: number | null;
}

interface CoursesPageProps {
  /** App-level state passed through for the course-detail Folders tab. */
  folders:               Folder[];
  userDocs:              Doc[];
  personas:              Persona[];
  /** Triggered when the user clicks "Chat about this course" inside the
   *  course detail. App handles session bootstrapping. */
  onStartCourseChat:     (courseId: number) => void;
  /** Cross-page navigation to My Library with the folder drilled in. */
  onOpenFolderInLibrary: (folderId: number) => void;
  /** Lets the course detail's Folders tab create folders pre-attached to
   *  the current course (F-031 / T-013). Forwarded straight to
   *  `useFolders.createFolder` by App.tsx. */
  onCreateFolder?: (p: {
    name: string; color: string | null; is_starred: boolean;
    persona_id: string | null; course_id: number | null;
  }) => Promise<Folder>;
  /** F-036: open a lecture in MainWorkspace as a real session. Forwarded
   *  to CourseDetailView → CourseLecturesTab. */
  onOpenLecture?: (lecture: any) => void;
}

/**
 * Top-level Courses page (sidebar entry — view='gallery'). Owns:
 *  - tab switching (My / Public)
 *  - the user's `courses` list, refreshed on mount + on hide/unhide
 *  - the `activeCourseId` state that drills into a course detail view
 *  - the create / edit CourseModal
 *
 * Public Courses tab still uses the existing PublicCoursesPage component
 * for the catalog rendering; click events are routed up to set
 * `activeCourseId` here so drilldown stays inside this page (no bouncing
 * back to My Library, fixes B-012/B-013 follow-on).
 */
export default function CoursesPage({
  folders,
  userDocs,
  personas,
  onStartCourseChat,
  onOpenFolderInLibrary,
  onCreateFolder,
  onOpenLecture,
}: CoursesPageProps) {
  const [activeTab,       setActiveTab]       = useState<CoursesTab>('my');
  const [activeCourseId,  setActiveCourseId]  = useState<number | null>(null);
  const [externalCourse,  setExternalCourse]  = useState<Course | null>(null);

  const [courses,         setCourses]         = useState<Course[]>([]);
  const [coursesLoading,  setCoursesLoading]  = useState(true);

  const [editingCourse,   setEditingCourse]   = useState<Course | null>(null);
  const [courseModalOpen, setCourseModalOpen] = useState(false);

  // ── Load user's courses on mount ───────────────────────────────────────
  const refreshCourses = async () => {
    try {
      const res = await api.listCourses();
      setCourses(res.data);
    } catch (err) {
      console.error('[CoursesPage] failed to load courses', err);
    } finally {
      setCoursesLoading(false);
    }
  };
  useEffect(() => { void refreshCourses(); }, []);

  // ── Drilldown ──────────────────────────────────────────────────────────
  const localCourse = activeCourseId == null
    ? null
    : courses.find(c => c.id === activeCourseId) ?? null;

  // If the active course is a public course the user hasn't starred, it
  // won't be in `courses` — fetch it separately so the detail view can
  // still render in read-only mode.
  useEffect(() => {
    if (activeCourseId == null) { setExternalCourse(null); return; }
    if (localCourse) { setExternalCourse(null); return; }
    let cancelled = false;
    api.getCourse(activeCourseId)
      .then(res => { if (!cancelled) setExternalCourse(res.data); })
      .catch(err => {
        console.error('[CoursesPage] could not load external course', err);
        if (!cancelled) setActiveCourseId(null);
      });
    return () => { cancelled = true; };
  }, [activeCourseId, localCourse]);

  const detailCourse = localCourse ?? externalCourse;

  // ── Hide / Unhide ──────────────────────────────────────────────────────
  async function handleToggleHidden(course: Course) {
    // Optimistic flip — server confirmation refreshes the canonical state.
    setCourses(prev => prev.map(c => c.id === course.id ? { ...c, is_hidden: !c.is_hidden } : c));
    try {
      const res = await api.setCourseHidden(course.id, !course.is_hidden);
      setCourses(prev => prev.map(c => c.id === course.id ? res.data : c));
    } catch (err) {
      console.error('[CoursesPage] hide toggle failed', err);
      // Roll back on failure.
      setCourses(prev => prev.map(c => c.id === course.id ? { ...c, is_hidden: course.is_hidden } : c));
      alert('Could not update course visibility. Please try again.');
    }
  }

  // ── Public-course click → drill in (no auto-star, per B-009 round 2) ───
  function handleOpenPublicCourse(course: PublicCourse) {
    setActiveCourseId(course.id);
  }

  // ── Drilldown branch ───────────────────────────────────────────────────
  if (activeCourseId != null) {
    if (!detailCourse) {
      return (
        <PageContainer>
          <div className="flex items-center justify-center py-24 gap-3 text-[#787774]">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            <span className="text-sm">Opening course…</span>
          </div>
        </PageContainer>
      );
    }
    return (
      <>
        <CourseDetailView
          course={detailCourse}
          folders={folders}
          userDocs={userDocs}
          personas={personas}
          onBack={() => setActiveCourseId(null)}
          onEdit={c => { setEditingCourse(c); setCourseModalOpen(true); }}
          onDelete={async c => {
            await api.deleteCourse(c.id);
            setActiveCourseId(null);
            await refreshCourses();
          }}
          onStartCourseChat={onStartCourseChat}
          onOpenFolderInLibrary={onOpenFolderInLibrary}
          onCreateFolder={onCreateFolder}
          onOpenLecture={onOpenLecture}
        />
        <CourseModal
          isOpen={courseModalOpen}
          editing={editingCourse}
          onClose={() => { setCourseModalOpen(false); setEditingCourse(null); }}
          onSaved={async () => { await refreshCourses(); }}
          onDeleted={async () => {
            setActiveCourseId(null);
            await refreshCourses();
          }}
        />
      </>
    );
  }

  // ── Default branch — tabs ──────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Courses"
        subtitle="Your courses, plus public courses shared by other students."
        icon={<GraduationCap className="w-5 h-5 text-indigo-600" />}
      />

      {/* Tabs */}
      <div className="flex border-b border-[#E8E8E6] mb-5">
        <button
          onClick={() => setActiveTab('my')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
            activeTab === 'my'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          My Courses
          <span className="text-[10px] text-[#C4C4C4]">({courses.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('public')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
            activeTab === 'public'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-[#787774] hover:text-[#37352F]'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          Public Courses
        </button>
      </div>

      {/* Tab body */}
      {activeTab === 'my' && (
        <MyCoursesTab
          courses={courses}
          isLoading={coursesLoading}
          onOpenCourse={setActiveCourseId}
          onEditCourse={c => { setEditingCourse(c); setCourseModalOpen(true); }}
          onCreateCourse={() => { setEditingCourse(null); setCourseModalOpen(true); }}
          onToggleHidden={handleToggleHidden}
        />
      )}

      {activeTab === 'public' && (
        <PublicCoursesPage onOpenCourse={handleOpenPublicCourse} embedded />
      )}

      {/* Course modal (create / edit / delete from settings tab — F-024) */}
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
