import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

interface LibraryLaneProps {
  /** Section label shown above the row of cards. */
  title: string;
  /** Optional count shown next to the title (e.g. "12"). */
  count?: number;
  /** When set, a search icon appears in the header — clicking it fires this callback. */
  onSearchClick?: () => void;
  /** Optional right-aligned action (e.g. a "+ New" button). */
  action?: React.ReactNode;
  /** Whether to show the empty state instead of the cards. */
  isEmpty?: boolean;
  /** Empty-state contents (icon + message + maybe an action). */
  emptyState?: React.ReactNode;
  /** Card grid — laid out as a horizontally-scrolling row. */
  children: React.ReactNode;
}

/**
 * A horizontal-scroll lane used in My Library to render Sessions / Folders /
 * Courses as Netflix-style rows. Wheel + arrow buttons drive the scroll.
 */
export default function LibraryLane({
  title, count, onSearchClick, action, isEmpty, emptyState, children,
}: LibraryLaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft]   = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Recalculate which arrows are enabled whenever the scroll position changes.
  const updateArrowState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateArrowState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrowState, { passive: true });
    window.addEventListener('resize', updateArrowState);
    return () => {
      el.removeEventListener('scroll', updateArrowState);
      window.removeEventListener('resize', updateArrowState);
    };
  }, [children]);

  const scrollByPage = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.8, 320);
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <section className="mb-8">
      {/* ── Lane header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">
            {title}
          </h2>
          {typeof count === 'number' && (
            <span className="text-xs text-[#C4C4C4] font-normal">
              ({count})
            </span>
          )}
          {onSearchClick && (
            <button
              onClick={onSearchClick}
              title="Search this lane"
              className="ms-1 p-1 rounded-md text-[#C4C4C4] hover:text-indigo-600 hover:bg-indigo-50 transition-colors duration-150"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {!isEmpty && (
            <>
              <button
                onClick={() => scrollByPage('left')}
                disabled={!canScrollLeft}
                className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#EFEFED] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => scrollByPage('right')}
                disabled={!canScrollRight}
                className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#EFEFED] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Lane body ─────────────────────────────────────────────────── */}
      {isEmpty ? (
        <div className="bg-white border border-dashed border-[#E8E8E6] rounded-xl py-8 px-6">
          {emptyState}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth pb-2 -mx-1 px-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {children}
        </div>
      )}
    </section>
  );
}
