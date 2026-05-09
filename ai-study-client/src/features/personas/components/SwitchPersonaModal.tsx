import { useState } from 'react';
import { X, Wand2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

// ── Props ──────────────────────────────────────────────────────────────────

interface SwitchPersonaModalProps {
  isOpen: boolean;
  currentPersonaId: string | null;
  currentPersonaName: string | null;
  onClose: () => void;
  onSwitch: (newId: string | null, keepContext: boolean) => void;
}

// ── Mini persona card ──────────────────────────────────────────────────────

interface MiniCardProps {
  icon: string;
  name: string;
  isSelected: boolean;
  onClick: () => void;
}

function MiniCard({ icon, name, isSelected, onClick }: MiniCardProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 w-[90px] flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150 ${
        isSelected
          ? 'border-indigo-500 bg-indigo-50'
          : 'border-[#E8E8E6] bg-white hover:border-[#C4C4C4] hover:bg-[#F7F7F5]'
      }`}
    >
      <span className="text-2xl leading-none select-none">{icon}</span>
      <span
        className={`text-[10px] font-medium text-center leading-tight w-full line-clamp-2 ${
          isSelected ? 'text-indigo-700' : 'text-[#37352F]'
        }`}
      >
        {name}
      </span>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SwitchPersonaModal({
  isOpen,
  currentPersonaId,
  currentPersonaName,
  onClose,
  onSwitch,
}: SwitchPersonaModalProps) {
  const personas = useAppStore(state => state.personas);
  const personalPersonas = personas.filter(p => p.type === 'personal');

  const [selectedId, setSelectedId]     = useState<string | null>(currentPersonaId);
  const [keepContext, setKeepContext]    = useState(true);

  if (!isOpen) return null;

  const selectedPersona = selectedId ? personas.find(p => p.id === selectedId) : null;
  const isDifferent     = selectedId !== currentPersonaId;

  function handleApply() {
    if (!isDifferent) { onClose(); return; }
    onSwitch(selectedId, keepContext);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col border border-[#E8E8E6] max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-base font-semibold text-[#37352F] flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-indigo-500" />
              Switch Agent
            </h2>
            <p className="text-xs text-[#787774] mt-1">
              Currently: <span className="font-medium text-[#37352F]">{currentPersonaName ?? 'No Agent'}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0 ms-4"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Agent selection ──────────────────────────────────────────── */}
        <div className="px-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-3">
            Choose an Agent
          </p>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {/* No Agent */}
            <MiniCard
              icon="🤖"
              name="No Agent"
              isSelected={selectedId === null}
              onClick={() => setSelectedId(null)}
            />
            {personalPersonas.map(p => (
              <MiniCard
                key={p.id}
                icon={p.icon}
                name={p.name}
                isSelected={selectedId === p.id}
                onClick={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        </div>

        {/* ── Description strip ───────────────────────────────────────── */}
        <div className="px-6 mt-3 mb-4 min-h-[40px]">
          {selectedPersona ? (
            <div className="px-3 py-2 bg-[#F7F7F5] border border-[#E8E8E6] rounded-lg">
              <p className="text-xs text-[#37352F] leading-relaxed">
                <span className="font-medium">{selectedPersona.name}: </span>
                <span className="text-[#787774]">{selectedPersona.description}</span>
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#C4C4C4] italic ps-1">
              No Agent — the model will respond with default behavior.
            </p>
          )}
        </div>

        {/* ── Keep context toggle (only shown when switching) ──────────── */}
        {isDifferent && (
          <div className="mx-6 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-amber-800">Keep conversation context?</p>
              <p className="text-[10px] text-amber-600 mt-0.5">
                The new agent will see this session's chat history.
              </p>
            </div>
            <button
              onClick={() => setKeepContext(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors duration-150 shrink-0 ${
                keepContext ? 'bg-indigo-600' : 'bg-[#C4C4C4]'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-150 ${
                  keepContext ? 'start-5' : 'start-0.5'
                }`}
              />
            </button>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 pt-4 border-t border-[#E8E8E6] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6] transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150 disabled:opacity-40"
          >
            {isDifferent ? 'Apply Switch' : 'Done'}
          </button>
        </div>

      </div>
    </div>
  );
}
