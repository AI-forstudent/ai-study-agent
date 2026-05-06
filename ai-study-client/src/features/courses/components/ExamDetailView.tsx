import { useEffect, useState } from 'react';
import {
  ArrowLeft, Calendar, Tag, GraduationCap, FileText, ChevronDown,
  TrendingUp, Loader2, Trash2, Lightbulb, Hash,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import type { ExamCard, ExamDetail, ExamQuestion } from '../../../types/course';
import { api } from '../../../services/api';

interface ExamDetailViewProps {
  examCard: ExamCard;
  isOwner:  boolean;
  onBack:   () => void;
  onDeleted: (examId: number) => void;
}

const mdComponents = {
  p:      ({ node, ...props }: any) => <p dir="auto" {...props} />,
  li:     ({ node, ...props }: any) => <li dir="auto" {...props} />,
  code:   ({ node, ...props }: any) => <code dir="ltr" className="bg-[#F7F7F5] px-1 py-0.5 rounded text-[11px]" {...props} />,
  strong: ({ node, ...props }: any) => <strong className="text-[#37352F] font-semibold" {...props} />,
};

function difficultyBadge(score: number | null) {
  if (score == null) {
    return { label: '—', cls: 'text-[#C4C4C4] bg-[#F7F7F5] border-[#E8E8E6]' };
  }
  if (score < 0.33) return { label: 'Easy',   cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  if (score < 0.66) return { label: 'Medium', cls: 'text-amber-700   bg-amber-50   border-amber-200' };
  return                   { label: 'Hard',   cls: 'text-red-700     bg-red-50     border-red-200' };
}

export default function ExamDetailView({
  examCard, isOwner, onBack, onDeleted,
}: ExamDetailViewProps) {
  const [detail, setDetail]   = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getExam(examCard.id)
      .then(res => setDetail(res.data))
      .catch(err => {
        console.error('[ExamDetailView] fetch failed', err);
        setError('Could not load exam details.');
      })
      .finally(() => setLoading(false));
  }, [examCard.id]);

  const handleDelete = async () => {
    if (!confirm(`Delete "${examCard.title}"? This removes all extracted questions.`)) return;
    try {
      await api.deleteExam(examCard.id);
      onDeleted(examCard.id);
    } catch (err) {
      console.error('[ExamDetailView] delete failed', err);
      alert('Could not delete exam.');
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            All exams
          </button>
        </div>
        {isOwner && (
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-100 rounded-md hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete exam
          </button>
        )}
      </div>

      {/* ── Title + meta ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E8E8E6] rounded-xl p-5">
        <h2 className="text-base font-semibold text-[#37352F] mb-2">{examCard.title}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#787774]">
          {(examCard.year || examCard.semester) && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {[examCard.semester, examCard.year].filter(Boolean).join(' · ')}
            </span>
          )}
          {examCard.lecturers.length > 0 && (
            <span className="flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5" />
              {examCard.lecturers.map(l => l.name).join(', ')}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {examCard.question_count} question{examCard.question_count === 1 ? '' : 's'}
          </span>
          {examCard.aggregate_difficulty != null && (() => {
            const b = difficultyBadge(examCard.aggregate_difficulty);
            return (
              <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${b.cls}`}>
                <TrendingUp className="w-3 h-3" />
                {b.label} · {(examCard.aggregate_difficulty * 100).toFixed(0)}%
              </span>
            );
          })()}
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
            examCard.has_solutions
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            {examCard.has_solutions ? 'Original has solutions' : 'AI-generated solutions'}
          </span>
        </div>

        {examCard.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[#E8E8E6]">
            <Tag className="w-3 h-3 text-[#C4C4C4] mt-0.5" />
            {examCard.topics.map(t => (
              <span key={t.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Questions ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-[#787774]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading questions…</span>
        </div>
      ) : error ? (
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          {error}
        </div>
      ) : detail && detail.questions.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#787774]">
            Questions ({detail.questions.length})
          </h3>
          {detail.questions.map(q => <QuestionCard key={q.id} q={q} />)}
        </div>
      ) : (
        <p className="text-sm text-[#C4C4C4] italic">No questions extracted from this exam.</p>
      )}
    </div>
  );
}

// ── Question card with collapsible reference solution ──────────────────────

function QuestionCard({ q }: { q: ExamQuestion }) {
  const [solutionOpen, setSolutionOpen] = useState(false);
  const b = difficultyBadge(q.difficulty_score);

  return (
    <article className="bg-white border border-[#E8E8E6] rounded-xl p-4">
      <header className="flex items-start gap-3 mb-2">
        <span className="flex items-center gap-1 text-xs font-mono font-semibold text-[#787774] bg-[#F7F7F5] border border-[#E8E8E6] rounded-md px-1.5 py-0.5 shrink-0">
          <Hash className="w-3 h-3" />
          {q.question_number}
        </span>
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          {q.question_type && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
              {q.question_type.name}
            </span>
          )}
          {q.topics.map(t => (
            <span key={t.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
              {t.name}
            </span>
          ))}
          <span className={`ms-auto text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${b.cls}`}>
            {b.label}
            {q.difficulty_score != null && ` · ${(q.difficulty_score * 100).toFixed(0)}%`}
          </span>
          {q.page_number != null && (
            <span className="text-[10px] text-[#C4C4C4]">p.{q.page_number}</span>
          )}
        </div>
      </header>

      <div className="text-sm text-[#37352F] leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents}
        >
          {q.question_text}
        </ReactMarkdown>
      </div>

      {q.reference_solution && (
        <details
          open={solutionOpen}
          onToggle={e => setSolutionOpen((e.target as HTMLDetailsElement).open)}
          className="mt-3 border-t border-[#E8E8E6] pt-3"
        >
          <summary className="cursor-pointer flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 select-none">
            <Lightbulb className="w-3.5 h-3.5" />
            Reference solution
            <ChevronDown className={`w-3 h-3 ms-auto transition-transform ${solutionOpen ? 'rotate-180' : ''}`} />
          </summary>
          <div className="mt-2 text-sm text-[#37352F] bg-[#F7F7F5] rounded-lg p-3 prose prose-sm max-w-none prose-p:my-1">
            <ReactMarkdown
              remarkPlugins={[remarkMath, remarkGfm]}
              rehypePlugins={[rehypeKatex]}
              components={mdComponents}
            >
              {q.reference_solution}
            </ReactMarkdown>
          </div>
        </details>
      )}
    </article>
  );
}
