import { useEffect, useMemo, useState } from 'react';
import { PieChart, BarChart3, TrendingUp, ChevronDown } from 'lucide-react';
import { api } from '../../../services/api';
import type { ExamStats, ExamCard } from '../../../types/course';

interface ExamStatsHeaderProps {
  courseId: number;
  /** When this number changes, the header re-fetches stats — used by
   *  CourseExamsTab to invalidate after an exam finishes processing or
   *  is deleted. */
  invalidateKey?: number;
  /** Source of truth for exam count, used for the bottom-right subtitle.
   *  When zero, we render nothing (the empty-state lives in CourseExamsTab). */
  exams: ExamCard[];
}

// ── Visual palette — kept in one place so legend and chart slices align ────
const PALETTE = [
  '#6366F1', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#8B5CF6', '#64748B',
  '#14B8A6', '#A855F7',
];

/**
 * Stats header for the Exams tab.
 *
 * Three small cards, each backed by REAL aggregation from
 * `GET /api/v1/courses/{id}/exam-stats`:
 *
 *   • Question types — donut + side legend
 *   • Topics — horizontal bars
 *   • Difficulty mix — 5-bucket histogram
 *
 * Each card has a "View all (N)" toggle that swaps the chart for a
 * scrollable full-list view of every topic / type / bucket the course
 * has accumulated. No chart-library dependency — inline SVG + CSS divs.
 */
export default function ExamStatsHeader({ courseId, invalidateKey = 0, exams }: ExamStatsHeaderProps) {
  const [stats, setStats] = useState<ExamStats | null>(null);

  useEffect(() => {
    if (exams.length === 0) {
      setStats(null);
      return;
    }
    let cancelled = false;
    api.getCourseExamStats(courseId)
      .then(res => { if (!cancelled) setStats(res.data); })
      .catch(err => {
        if (!cancelled) console.error('[ExamStatsHeader] stats fetch failed', err);
      });
    return () => { cancelled = true; };
  }, [courseId, invalidateKey, exams.length]);

  if (exams.length === 0) {
    return null;
  }

  // ── Derived display data ──────────────────────────────────────────────
  // Filter out zero-count rows from the visualisations — they exist in the
  // course taxonomy (e.g. left over from a syllabus extraction) but haven't
  // shown up in any exam yet, so they'd just create empty slices.
  const typesAll  = stats?.question_types?.filter(t => t.question_count > 0) ?? [];
  const topicsAll = stats?.topics?.filter(t => t.question_count > 0) ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <StatCard title="Question types" icon={PieChart} subtitle={`${typesAll.length} type${typesAll.length === 1 ? '' : 's'}`}>
        {typesAll.length === 0 ? (
          <Empty hint={stats === null ? 'Loading…' : 'No question types tagged yet.'} />
        ) : (
          <DonutWithLegend
            items={typesAll.map((t, i) => ({
              key: t.name,
              label: t.name,
              count: t.question_count,
              color: PALETTE[i % PALETTE.length],
            }))}
            totalLabel={`${typesAll.reduce((a, b) => a + b.question_count, 0)} Qs`}
          />
        )}
      </StatCard>

      <StatCard title="Topics" icon={BarChart3} subtitle={`${topicsAll.length} topic${topicsAll.length === 1 ? '' : 's'}`}>
        {topicsAll.length === 0 ? (
          <Empty hint={stats === null ? 'Loading…' : 'No topics tagged yet.'} />
        ) : (
          <HBarList
            items={topicsAll.map((t, i) => ({
              key: t.name,
              label: t.name,
              count: t.question_count,
              color: PALETTE[i % PALETTE.length],
            }))}
          />
        )}
      </StatCard>

      <StatCard title="Difficulty mix" icon={TrendingUp} subtitle={`${stats?.exam_count_processed ?? 0} processed`}>
        {!stats || stats.difficulty_buckets.every(b => b === 0) ? (
          <Empty hint="No difficulty scores yet." />
        ) : (
          <Histogram buckets={stats.difficulty_buckets} />
        )}
      </StatCard>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Card wrapper
// ──────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  title:    string;
  icon:     React.ElementType;
  subtitle: string;
  children: React.ReactNode;
}

function StatCard({ title, icon: Icon, subtitle, children }: StatCardProps) {
  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-[#787774]" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">{title}</h3>
        <span className="text-[10px] text-[#C4C4C4] ms-auto">{subtitle}</span>
      </div>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="h-32 flex items-center justify-center">
      <p className="text-xs text-[#C4C4C4] italic text-center">{hint}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Donut + legend with "View all" expander
// ──────────────────────────────────────────────────────────────────────────

interface Item {
  key:   string;
  label: string;
  count: number;
  color: string;
}

const _LEGEND_VISIBLE = 5;
const _BARS_VISIBLE   = 6;

function DonutWithLegend({ items, totalLabel }: { items: Item[]; totalLabel: string }) {
  const [showAll, setShowAll] = useState(false);
  const total = items.reduce((acc, s) => acc + s.count, 0) || 1;

  // Build SVG arc paths via accumulated radians.
  const cx = 50, cy = 50, rOuter = 42, rInner = 26;
  let acc = 0;
  const paths = items.map(slice => {
    const startA = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += slice.count;
    const endA = (acc / total) * 2 * Math.PI - Math.PI / 2;
    return { d: arcPath(cx, cy, rOuter, rInner, startA, endA), color: slice.color, key: slice.key };
  });

  const visible  = showAll ? items : items.slice(0, _LEGEND_VISIBLE);
  const overflow = items.length - _LEGEND_VISIBLE;

  return (
    <div className="flex items-start gap-4">
      <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0">
        {paths.map(p => <path key={p.key} d={p.d} fill={p.color} />)}
        <text x="50" y="48" textAnchor="middle" className="fill-[#37352F]" style={{ fontSize: 9, fontWeight: 600 }}>
          {totalLabel}
        </text>
      </svg>
      <div className="flex-1 min-w-0">
        <div className={`space-y-1 ${showAll ? 'max-h-44 overflow-y-auto pr-1' : ''}`}>
          {visible.map(s => (
            <div key={s.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-[#37352F] truncate" title={s.label}>{s.label}</span>
              <span className="text-[#C4C4C4] ms-auto">{s.count}</span>
            </div>
          ))}
        </div>
        {overflow > 0 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? 'rotate-180' : ''}`} />
            {showAll ? 'Show less' : `View all (${items.length})`}
          </button>
        )}
      </div>
    </div>
  );
}

function arcPath(
  cx: number, cy: number, rOuter: number, rInner: number,
  startA: number, endA: number,
): string {
  const span = endA - startA;
  // Special-case full-circle so the donut renders cleanly when there's
  // only a single category.
  if (span >= 2 * Math.PI - 1e-6) {
    return [
      `M ${cx + rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy}`,
      `M ${cx + rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}`,
      'Z',
    ].join(' ');
  }
  const x1 = cx + rOuter * Math.cos(startA), y1 = cy + rOuter * Math.sin(startA);
  const x2 = cx + rOuter * Math.cos(endA),   y2 = cy + rOuter * Math.sin(endA);
  const x3 = cx + rInner * Math.cos(endA),   y3 = cy + rInner * Math.sin(endA);
  const x4 = cx + rInner * Math.cos(startA), y4 = cy + rInner * Math.sin(startA);
  const large = span > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

// ──────────────────────────────────────────────────────────────────────────
// Horizontal bar list with "View all"
// ──────────────────────────────────────────────────────────────────────────

function HBarList({ items }: { items: Item[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, _BARS_VISIBLE);
  const overflow = items.length - _BARS_VISIBLE;
  const max = Math.max(...items.map(b => b.count), 1);

  return (
    <div className="flex flex-col">
      <div className={`space-y-2 ${showAll ? 'max-h-56 overflow-y-auto pr-1' : ''}`}>
        {visible.map(b => (
          <div key={b.key} className="space-y-0.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#37352F] truncate me-2" title={b.label}>{b.label}</span>
              <span className="text-[#C4C4C4] shrink-0">{b.count}</span>
            </div>
            <div className="h-1.5 bg-[#F7F7F5] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(b.count / max) * 100}%`, backgroundColor: b.color }}
              />
            </div>
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-2 flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? 'rotate-180' : ''}`} />
          {showAll ? 'Show less' : `View all (${items.length})`}
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Histogram
// ──────────────────────────────────────────────────────────────────────────

function Histogram({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1);
  const labels = ['Easy', '·', 'Medium', '·', 'Hard'];
  // Sequential color ramp so the chart reads as "easier left, harder right"
  // without needing a legend.
  const ramp = ['#10B981', '#65A30D', '#F59E0B', '#EA580C', '#DC2626'];
  return (
    <div>
      <div className="flex items-end gap-1.5 h-24">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[9px] text-[#C4C4C4]">{count || ''}</span>
            <div
              className="w-full rounded-t"
              style={{
                height: `${(count / max) * 100}%`,
                minHeight: count > 0 ? '4px' : '0',
                backgroundColor: ramp[i],
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 px-0.5">
        {labels.map((l, i) => (
          <span key={i} className="text-[9px] text-[#C4C4C4] flex-1 text-center">{l}</span>
        ))}
      </div>
    </div>
  );
}
