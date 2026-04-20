import { useState } from 'react';
import { ChevronDown, Download, Brain, Zap } from 'lucide-react';
import { getFileIconConfig } from '../../utils/fileIcons';
import { useAppStore } from '../../store/useAppStore';

interface WorkspaceHeaderProps {
  documentTitle: string;
  onExportSession?: () => void;
  /** Called when the user clicks "Save to Persona Memory" — triggers the wrap-up modal. */
  onSaveMemory?: () => void;
}

type ModelTier = 'flash-lite' | 'flash' | 'pro';

const MODEL_TIERS: { value: ModelTier; label: string; title: string }[] = [
  { value: 'flash-lite', label: 'Fast',     title: 'Fast & Efficient'  },
  { value: 'flash',      label: 'Balanced', title: 'Balanced'          },
  { value: 'pro',        label: 'Deep',     title: 'Deep Analysis'     },
];

export default function WorkspaceHeader({
  documentTitle,
  onExportSession,
  onSaveMemory,
}: WorkspaceHeaderProps) {
  const [isExpanded, setIsExpanded]   = useState(false);
  const selectedModelTier             = useAppStore(state => state.selectedModelTier);
  const setSelectedModelTier          = useAppStore(state => state.setSelectedModelTier);
  const { Icon: FileTypeIcon }        = getFileIconConfig(documentTitle);

  return (
    <div className="bg-white border-b border-[#E8E8E6] shrink-0 select-none">

      {/* ── Main bar — entire row is clickable ────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(v => !v)}
        onKeyDown={e => e.key === 'Enter' && setIsExpanded(v => !v)}
        className="flex items-center justify-between px-4 h-14 cursor-pointer hover:bg-[#F7F7F5] transition-colors duration-150"
        title={isExpanded ? 'Collapse toolbar' : 'Expand toolbar'}
      >
        {/* Left: chevron + file icon + title */}
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#C4C4C4] shrink-0 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
          <FileTypeIcon className="w-3.5 h-3.5 text-[#C4C4C4] shrink-0" />
          <span className="text-sm font-medium text-[#37352F] truncate max-w-xs" title={documentTitle}>
            {documentTitle}
          </span>
        </div>

        {/* Right: mirrored chevron */}
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#C4C4C4] shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </div>

      {/* ── Expandable action row ──────────────────────────────────────── */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isExpanded ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex items-center gap-3 px-4 pb-3 pt-1">
          <button
            onClick={e => { e.stopPropagation(); onExportSession?.(); console.log('INTENT: export session'); }}
            className="flex items-center gap-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] border border-[#E8E8E6] px-4 py-2 rounded-lg transition-colors duration-150"
          >
            <Download className="w-4 h-4" />
            Export Session
          </button>
          <button
            onClick={e => { e.stopPropagation(); onSaveMemory?.(); }}
            className="flex items-center gap-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] border border-[#E8E8E6] px-4 py-2 rounded-lg transition-colors duration-150"
          >
            <Brain className="w-4 h-4" />
            Save to Persona Memory
          </button>

          {/* ── Model Intelligence segmented control ────────────────── */}
          <div
            className="ms-auto flex items-center gap-1"
            onClick={e => e.stopPropagation()}
            title="Model Intelligence"
          >
            <Zap className="w-3.5 h-3.5 text-[#C4C4C4] shrink-0 me-1" />
            <div className="flex items-center bg-[#F7F7F5] border border-[#E8E8E6] rounded-lg p-0.5">
              {MODEL_TIERS.map(tier => (
                <button
                  key={tier.value}
                  onClick={() => setSelectedModelTier(tier.value)}
                  title={tier.title}
                  className={`px-2.5 py-1 text-sm font-medium rounded-md transition-colors duration-150 ${
                    selectedModelTier === tier.value
                      ? 'bg-white text-[#37352F] border border-[#E8E8E6]'
                      : 'text-[#787774] hover:text-[#37352F]'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
