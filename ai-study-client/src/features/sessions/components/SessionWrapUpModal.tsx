import { useState, useEffect } from 'react';
import { X, Brain } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface SessionWrapUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with compression level and user instructions when the user confirms. */
  onSave: (compressionLevel: number, userInstructions: string) => void;
  /** The active persona name — shown in the description. Null if no persona. */
  personaName: string | null;
}

interface CompressionOption {
  level: number;
  label: string;
  description: string;
}

const COMPRESSION_OPTIONS: CompressionOption[] = [
  { level: 1, label: 'Deep',     description: 'Full transcript and details' },
  { level: 2, label: 'Thematic', description: 'Key topics and my struggles' },
  { level: 3, label: 'Minimal',  description: '1–2 sentence punchline' },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function SessionWrapUpModal({
  isOpen,
  onClose,
  onSave,
  personaName,
}: SessionWrapUpModalProps) {
  const [compressionLevel, setCompressionLevel] = useState(2);
  const [userInstructions, setUserInstructions] = useState('');

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Reset each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setCompressionLevel(2);
      setUserInstructions('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSave() {
    onSave(compressionLevel, userInstructions.trim());
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col border border-[#E8E8E6]"
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold text-[#37352F] leading-tight">
              Wrap up your session
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0 ms-4"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Description ─────────────────────────────────────────────── */}
        <p className="px-6 pb-4 text-sm text-[#787774] leading-relaxed">
          Choose how this session will be remembered by{' '}
          {personaName
            ? <span className="font-medium text-[#37352F]">{personaName}</span>
            : 'the agent'
          }.
        </p>

        {/* ── Compression level selector ───────────────────────────────── */}
        <div className="px-6 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2">
            Memory Compression Level
          </p>
          <div className="flex gap-2">
            {COMPRESSION_OPTIONS.map(opt => (
              <button
                key={opt.level}
                onClick={() => setCompressionLevel(opt.level)}
                className={`flex-1 flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl border-2 text-start transition-all duration-150 ${
                  compressionLevel === opt.level
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-[#E8E8E6] bg-white hover:border-[#C4C4C4] hover:bg-[#F7F7F5]'
                }`}
              >
                <span className={`text-xs font-semibold ${compressionLevel === opt.level ? 'text-indigo-700' : 'text-[#37352F]'}`}>
                  {opt.label}
                </span>
                <span className={`text-[10px] leading-tight ${compressionLevel === opt.level ? 'text-indigo-500' : 'text-[#787774]'}`}>
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Additional instructions textarea ────────────────────────── */}
        <div className="px-6 pb-5">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2">
            Additional AI Instructions
          </label>
          <textarea
            value={userInstructions}
            onChange={e => setUserInstructions(e.target.value)}
            placeholder="e.g. Focus on multiple-choice next time"
            dir="auto"
            className="w-full min-h-[100px] resize-y border border-[#E8E8E6] rounded-xl px-4 py-3 text-sm text-[#37352F] placeholder:text-[#C4C4C4] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
          />
          <p className="text-[10px] text-[#C4C4C4] mt-1.5 text-end">
            {userInstructions.split(/\s+/).filter(Boolean).length} words
          </p>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 pt-2 border-t border-[#E8E8E6] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6] transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
          >
            <Brain className="w-4 h-4" />
            Save Memory &amp; End Session
          </button>
        </div>

      </div>
    </div>
  );
}
