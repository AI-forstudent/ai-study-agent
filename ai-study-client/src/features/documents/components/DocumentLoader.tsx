import { FileWarning } from 'lucide-react';

// ── Skeleton lines per "page" — varying widths to mimic real text ─────────────
const LINES = [100, 96, 98, 88, 100, 72, 94, 97, 83, 90];

function SkeletonPage({ opacity }: { opacity: number }) {
  return (
    <div
      className="w-[700px] max-w-full bg-white shadow-sm border border-[#E8E8E6] rounded-sm px-10 py-12 space-y-3"
      style={{ opacity }}
    >
      <div className="h-4 bg-[#E2E2E0] rounded animate-pulse" style={{ width: '52%' }} />
      <div className="h-3 bg-[#EBEBEA] rounded animate-pulse" style={{ width: '33%', animationDelay: '60ms' }} />
      <div className="pt-4 space-y-2.5">
        {LINES.map((w, i) => (
          <div
            key={i}
            className="h-3 bg-[#EFEFED] rounded animate-pulse"
            style={{ width: `${w}%`, animationDelay: `${i * 45}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

interface DocumentLoaderProps {
  /** Shown below the spinner. Defaults to "Loading document…" */
  message?: string;
}

/** Full-area skeleton shown while the PDF document is loading or converting. */
export default function DocumentLoader({ message }: DocumentLoaderProps = {}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8 w-full">
      {/* Circular spinner + status label */}
      <div className="flex flex-col items-center gap-2.5">
        <div className="w-8 h-8 rounded-full border-[2.5px] border-[#E8E8E6] border-t-[#787774] animate-spin" />
        <span className="text-xs font-medium text-[#787774] tracking-wide">
          {message ?? 'Loading document…'}
        </span>
      </div>

      <SkeletonPage opacity={1}    />
      <SkeletonPage opacity={0.65} />
      <SkeletonPage opacity={0.35} />
    </div>
  );
}

/** Inline error state shown when react-pdf fails and polling times out. */
export function DocumentError() {
  return (
    <div className="flex flex-col items-center justify-center w-full min-h-[400px] gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center">
        <FileWarning className="w-7 h-7 text-rose-400" />
      </div>
      <div className="max-w-xs">
        <p className="text-sm font-semibold text-[#37352F]">Failed to load document</p>
        <p className="text-xs text-[#787774] mt-1.5 leading-relaxed">
          The document could not be prepared in time. Please refresh the page or try again.
        </p>
      </div>
    </div>
  );
}
