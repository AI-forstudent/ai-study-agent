import { GraduationCap, Globe, Lock, Users, FileText, Pencil, Trash2 } from 'lucide-react';
import type { Course } from '../../../types/course';

interface CourseCardProps {
  course: Course;
  onOpen: (courseId: number) => void;
  onEdit?: (course: Course) => void;
  onDelete?: (course: Course) => void;
}

function visibilityBadge(visibility: Course['visibility']) {
  if (visibility === 'public') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Globe className="w-2.5 h-2.5" /> Public
      </span>
    );
  }
  if (visibility === 'admin_assigned') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
        <Users className="w-2.5 h-2.5" /> Assigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[#F7F7F5] text-[#787774] border border-[#E8E8E6]">
      <Lock className="w-2.5 h-2.5" /> Private
    </span>
  );
}

export default function CourseCard({ course, onOpen, onEdit, onDelete }: CourseCardProps) {
  const accent = course.color ?? '#6366F1';
  const isOwner = course.role === 'owner';

  return (
    <div
      onClick={() => onOpen(course.id)}
      className="group shrink-0 w-64 bg-white border border-[#E8E8E6] rounded-xl p-4 cursor-pointer hover:border-[#C4C4C4] hover:shadow-sm transition-all duration-150 flex flex-col gap-2 relative overflow-hidden"
    >
      {/* Color accent strip */}
      <div className="absolute top-0 inset-x-0 h-1" style={{ backgroundColor: accent }} />

      <div className="flex items-start gap-2 mt-1">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-lg select-none"
          style={{ backgroundColor: `${accent}1A`, color: accent }}
        >
          {course.icon ?? <GraduationCap className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#37352F] leading-snug truncate" title={course.title}>
            {course.title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">{visibilityBadge(course.visibility)}</div>
        </div>
      </div>

      {course.description ? (
        <p className="text-xs text-[#787774] line-clamp-2 leading-relaxed flex-1 min-h-[2.4rem]">
          {course.description}
        </p>
      ) : (
        <p className="text-xs text-[#C4C4C4] italic line-clamp-2 leading-relaxed flex-1 min-h-[2.4rem]">
          No description yet.
        </p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-[#E8E8E6] text-[10px] text-[#C4C4C4]">
        <span className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {course.document_count} file{course.document_count === 1 ? '' : 's'}
        </span>
        {isOwner && (
          <span className="flex items-center gap-0.5">
            {onEdit && (
              <button
                onClick={e => { e.stopPropagation(); onEdit(course); }}
                title="Edit course"
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[#C4C4C4] hover:text-indigo-600 hover:bg-indigo-50 transition-all duration-150"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(course); }}
                title="Delete course"
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-[#C4C4C4] hover:text-red-500 hover:bg-red-50 transition-all duration-150"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
