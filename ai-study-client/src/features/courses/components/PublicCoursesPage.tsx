import { useEffect, useState } from 'react';
import { Globe, Search, Star, Users, FileText, GraduationCap, Loader2 } from 'lucide-react';
import PageContainer from '../../../components/layout/PageContainer';
import PageHeader from '../../../components/layout/PageHeader';
import type { PublicCourse } from '../../../types/course';
import { api } from '../../../services/api';

interface PublicCoursesPageProps {
  /** Called when the user clicks a course card to open it. The handler is
   *  expected to ensure the course is reachable from My Library (e.g. by
   *  starring it first) and then navigate the user there. */
  onOpenCourse?: (course: PublicCourse) => void;
}

export default function PublicCoursesPage({ onOpenCourse }: PublicCoursesPageProps = {}) {
  const [courses, setCourses]   = useState<PublicCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch]     = useState('');
  const [starringId, setStarringId] = useState<number | null>(null);
  const [openingId, setOpeningId]   = useState<number | null>(null);

  useEffect(() => {
    setIsLoading(true);
    api.listPublicCourses()
      .then(res => setCourses(res.data))
      .catch(err => console.error('[PublicCourses] fetch failed', err))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = courses.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.title.toLowerCase().includes(q) ||
           (c.description ?? '').toLowerCase().includes(q) ||
           c.owner_email.toLowerCase().includes(q);
  });

  function handleOpen(course: PublicCourse) {
    if (!onOpenCourse) return;
    setOpeningId(course.id);
    onOpenCourse(course);
  }

  async function toggleStar(course: PublicCourse) {
    setStarringId(course.id);
    const next = !course.is_starred;
    setCourses(prev => prev.map(c => c.id === course.id ? { ...c, is_starred: next } : c));
    try {
      await api.starCourse(course.id, next);
    } catch (err) {
      console.error('[starCourse]', err);
      // Roll back on failure
      setCourses(prev => prev.map(c => c.id === course.id ? { ...c, is_starred: !next } : c));
    } finally {
      setStarringId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Courses"
        subtitle="Browse public courses shared by other students. Star one to add it to your library."
        icon={<Globe className="w-5 h-5 text-indigo-600" />}
      />

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C4C4C4] pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search courses by name, description, or author…"
          className="w-full bg-white border border-[#E8E8E6] rounded-lg ps-9 pe-3 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-[#787774]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading courses…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-[#787774]">
          <Globe className="w-8 h-8 opacity-30" />
          <p className="text-sm">
            {search ? 'No public courses match your search.' : 'No public courses yet.'}
          </p>
          {!search && (
            <p className="text-xs text-[#C4C4C4]">
              Be the first — set a course visibility to “Public” from your library.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(course => {
            const accent = course.color ?? '#6366F1';
            return (
              <div
                key={course.id}
                onClick={() => handleOpen(course)}
                role={onOpenCourse ? 'button' : undefined}
                tabIndex={onOpenCourse ? 0 : undefined}
                onKeyDown={onOpenCourse ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(course); } }) : undefined}
                className={`group relative bg-white border border-[#E8E8E6] rounded-xl p-5 hover:border-[#C4C4C4] hover:shadow-sm transition-all duration-150 flex flex-col gap-3 overflow-hidden ${onOpenCourse ? 'cursor-pointer' : ''} ${openingId === course.id ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="absolute top-0 inset-x-0 h-1" style={{ backgroundColor: accent }} />

                <div className="flex items-start gap-3 mt-1">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xl select-none"
                    style={{ backgroundColor: `${accent}1A`, color: accent }}
                  >
                    {course.icon ?? <GraduationCap className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#37352F] leading-snug truncate" title={course.title}>
                      {course.title}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] text-[#787774] mt-0.5 truncate">
                      <Users className="w-2.5 h-2.5" />
                      {course.owner_email}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); toggleStar(course); }}
                    disabled={starringId === course.id}
                    title={course.is_starred ? 'Unstar — removes from My Library' : 'Star — adds to My Library'}
                    className={`p-2 rounded-md transition-colors duration-150 ${
                      course.is_starred
                        ? 'bg-amber-50 text-amber-500 hover:bg-amber-100'
                        : 'text-[#C4C4C4] hover:text-amber-400 hover:bg-amber-50'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${course.is_starred ? 'fill-amber-400' : ''}`} />
                  </button>
                </div>

                <p className={`text-xs leading-relaxed line-clamp-3 flex-1 ${course.description ? 'text-[#787774]' : 'text-[#C4C4C4] italic'}`}>
                  {course.description ?? 'No description.'}
                </p>

                <div className="flex items-center gap-1 pt-2 border-t border-[#E8E8E6] text-[10px] text-[#C4C4C4]">
                  <FileText className="w-3 h-3" />
                  {course.document_count} file{course.document_count === 1 ? '' : 's'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
