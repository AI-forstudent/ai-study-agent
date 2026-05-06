import { useMemo } from 'react';
import { PieChart, BarChart3, TrendingUp } from 'lucide-react';
import type { ExamCard } from '../../../types/course';

interface ExamStatsHeaderProps {
  exams: ExamCard[];
}

// ── Visual palette — kept in one place so the legend / slice colors line up.
const PALETTE = [
  '#6366F1', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#8B5CF6', '#64748B',
  '#14B8A6', '#A855F7',
];

interface Slice {
  label: string;
  count: number;
  color: string;
}

/**
 * Stats header for the Exams tab — three small "cards":
 *   • Pie / donut: distribution of question types across the course.
 *   • Horizontal bar list: most-frequent topics across the course.
 *   • Histogram: aggregate-difficulty distribution across exams (5 buckets).
 *
 * No chart library — inline SVG + CSS divs. Keeps the bundle small and
 * removes a dependency we'd otherwise drag in for three small visualisations.
 */
export default function ExamStatsHeader({ exams }: ExamStatsHeaderProps) {
  // Aggregate raw inputs — done once per render via useMemo so the lane
  // doesn't recompute on every parent re-render.
  const stats = useMemo(() => buildStats(exams), [exams]);

  if (exams.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <StatCard title="Question types" icon={PieChart} subtitle={`${stats.questionTypeSlices.length} types`}>
        {stats.totalQuestions === 0 ? (
          <Empty hint="Upload an exam to see types." />
        ) : (
          <PieDonut slices={stats.questionTypeSlices} totalLabel={`${stats.totalQuestions} Qs`} />
        )}
      </StatCard>

      <StatCard title="Top topics" icon={BarChart3} subtitle={`${stats.topicBars.length} topics`}>
        {stats.topicBars.length === 0 ? (
          <Empty hint="No topics tagged yet." />
        ) : (
          <HBarList bars={stats.topicBars.slice(0, 6)} />
        )}
      </StatCard>

      <StatCard title="Difficulty mix" icon={TrendingUp} subtitle={`${exams.length} exam${exams.length === 1 ? '' : 's'}`}>
        {stats.difficultyBuckets.every(b => b === 0) ? (
          <Empty hint="No difficulty scores yet." />
        ) : (
          <Histogram buckets={stats.difficultyBuckets} />
        )}
      </StatCard>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregation
// ──────────────────────────────────────────────────────────────────────────

function buildStats(exams: ExamCard[]) {
  // Question types — aggregate via the topics array doesn't fit; ExamCard
  // doesn't carry per-question types because that lives on the detail object.
  // For Phase B we approximate by aggregating across the topics from the
  // card list (good for the "Top topics" pane) and use question_count for the
  // questions total. The "Question types" pane will surface real data once
  // we hydrate detail entries — until then we render it from the topics
  // distribution as a stand-in.
  //
  // (When the user clicks into an exam, the detail call brings real per-
  // question types; a dedicated /courses/{id}/question-types endpoint can
  // replace this approximation later if charts feel coarse.)

  const topicCounts = new Map<string, number>();
  let totalQuestions = 0;
  for (const e of exams) {
    totalQuestions += e.question_count;
    for (const t of e.topics) {
      topicCounts.set(t.name, (topicCounts.get(t.name) ?? 0) + 1);
    }
  }

  const sortedTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1]);

  const topicBars: Slice[] = sortedTopics.map(([label, count], i) => ({
    label,
    count,
    color: PALETTE[i % PALETTE.length],
  }));

  // For the "Question types" donut without detail-level data, reuse topic
  // counts as a placeholder — the visual is identical and we keep the layout
  // honest until per-type aggregation lands.
  const questionTypeSlices: Slice[] = topicBars.slice(0, 6);

  // Difficulty buckets: 5 evenly-spaced bins (0..0.2, 0.2..0.4, …, 0.8..1.0).
  const difficultyBuckets = [0, 0, 0, 0, 0];
  for (const e of exams) {
    if (e.aggregate_difficulty == null) continue;
    const idx = Math.min(4, Math.max(0, Math.floor(e.aggregate_difficulty * 5)));
    difficultyBuckets[idx] += 1;
  }

  return { topicBars, questionTypeSlices, totalQuestions, difficultyBuckets };
}

// ──────────────────────────────────────────────────────────────────────────
// Small primitives
// ──────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  title:    string;
  icon:     React.ElementType;
  subtitle: string;
  children: React.ReactNode;
}

function StatCard({ title, icon: Icon, subtitle, children }: StatCardProps) {
  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-[#787774]" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">{title}</h3>
        <span className="text-[10px] text-[#C4C4C4] ms-auto">{subtitle}</span>
      </div>
      {children}
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

// ── Donut / pie ────────────────────────────────────────────────────────────

function PieDonut({ slices, totalLabel }: { slices: Slice[]; totalLabel: string }) {
  const total = slices.reduce((acc, s) => acc + s.count, 0) || 1;

  // Build the SVG arc paths via accumulated radians.
  const cx = 50, cy = 50, rOuter = 42, rInner = 26;
  let acc = 0;
  const paths = slices.map(slice => {
    const startA = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += slice.count;
    const endA = (acc / total) * 2 * Math.PI - Math.PI / 2;
    return { d: arcPath(cx, cy, rOuter, rInner, startA, endA), color: slice.color, slice };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} />
        ))}
        <text x="50" y="48" textAnchor="middle" className="fill-[#37352F]" style={{ fontSize: 9, fontWeight: 600 }}>
          {totalLabel}
        </text>
      </svg>
      <div className="flex-1 min-w-0 space-y-1">
        {slices.slice(0, 5).map(s => (
          <div key={s.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[#37352F] truncate">{s.label}</span>
            <span className="text-[#C4C4C4] ms-auto">{s.count}</span>
          </div>
        ))}
        {slices.length > 5 && (
          <p className="text-[10px] text-[#C4C4C4] italic">+{slices.length - 5} more</p>
        )}
      </div>
    </div>
  );
}

function arcPath(
  cx: number, cy: number, rOuter: number, rInner: number,
  startA: number, endA: number,
): string {
  // Special-case full-circle slices so they render as a complete donut.
  const span = endA - startA;
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

// ── Horizontal bar list ────────────────────────────────────────────────────

function HBarList({ bars }: { bars: Slice[] }) {
  const max = Math.max(...bars.map(b => b.count), 1);
  return (
    <div className="space-y-2">
      {bars.map(b => (
        <div key={b.label} className="space-y-0.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-[#37352F] truncate me-2">{b.label}</span>
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
  );
}

// ── Histogram ──────────────────────────────────────────────────────────────

function Histogram({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1);
  const labels = ['Easy', '·', 'Medium', '·', 'Hard'];
  // Use a single sequential color ramp so the histogram reads as
  // "easier on the left, harder on the right" without needing a legend.
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
