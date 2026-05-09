import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GraduationCap, Plus, EyeOff } from 'lucide-react';
import CourseCard from './CourseCard';
import type { Course } from '../../../types/course';

interface MyCoursesTabProps {
  courses:           Course[];
  isLoading:         boolean;
  onOpenCourse:      (id: number) => void;
  onEditCourse:      (course: Course) => void;
  onCreateCourse:    () => void;
  onToggleHidden:    (course: Course) => void;
}

/**
 * Renders the user's courses in two collapsible blocks — Visible and Hidden —
 * per the 2026-05-08 library restructure brief. The user controls each
 * course's bucket via the 3-dot menu on the card (Hide / Unhide). Hiding
 * does NOT unstar/unown — it only changes which block the card lives in.
 */
export default function MyCoursesTab({
  courses,
  isLoading,
  onOpenCourse,
  onEditCourse,
  onCreateCourse,
  onToggleHidden,
}: MyCoursesTabProps) {
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const { visibleCourses, hiddenCourses } = useMemo(() => {
    const visible: Course[] = [];
    const hidden:  Course[] = [];
    for (const c of courses) {
      (c.is_hidden ? hidden : visible).push(c);
    }
    return { visibleCourses: visible, hiddenCourses: hidden };
  }, [courses]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-[#787774]">
        <span className="text-sm">Loading courses…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Visible block ────────────────────────────────────────────── */}
      <section>
        <header className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">
            Visible
            <span className="ms-1.5 text-[#C4C4C4] font-normal">({visibleCourses.length})</span>
          </h3>
          <button
            onClick={onCreateCourse}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
          >
            <Plus className="w-4 h-4" />
            New course
          </button>
        </header>

        {visibleCourses.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E8E8E6] rounded-xl py-10 px-6 flex flex-col items-center gap-3 text-[#787774]">
            <GraduationCap className="w-8 h-8 opacity-30" />
            <p className="text-sm">No visible courses yet.</p>
            <button
              onClick={onCreateCourse}
              className="flex items-center gap-2 bg-white text-[#37352F] hover:bg-[#F7F7F5] text-sm font-medium px-4 py-2 rounded-lg border border-[#E8E8E6]"
            >
              <Plus className="w-4 h-4" />
              Create your first course
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleCourses.map(course => (
              <CourseCard
                key={course.id}
                course={course}
                onOpen={onOpenCourse}
                onEdit={course.role === 'owner' ? onEditCourse : undefined}
                onToggleHidden={onToggleHidden}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Hidden block (collapsible) ─────────────────────────────── */}
      {hiddenCourses.length > 0 && (
        <section>
          <button
            onClick={() => setHiddenOpen(v => !v)}
            className="w-full flex items-center justify-between py-2 px-3 -mx-3 rounded-lg hover:bg-[#F7F7F5] transition-colors duration-150"
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#787774]">
              <EyeOff className="w-3.5 h-3.5" />
              Hidden
              <span className="text-[#C4C4C4] font-normal">({hiddenCourses.length})</span>
            </span>
            {hiddenOpen
              ? <ChevronDown className="w-4 h-4 text-[#787774]" />
              : <ChevronRight className="w-4 h-4 text-[#787774]" />}
          </button>

          {hiddenOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-3 opacity-80">
              {hiddenCourses.map(course => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onOpen={onOpenCourse}
                  onEdit={course.role === 'owner' ? onEditCourse : undefined}
                  onToggleHidden={onToggleHidden}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
