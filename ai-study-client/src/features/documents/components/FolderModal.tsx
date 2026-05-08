import { useState, useEffect } from 'react';
import { X, Check, Star } from 'lucide-react';
import type { Folder } from '../hooks/useFolders';
import type { Persona } from '../../../types/persona';

const PRESET_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#3B82F6', '#EF4444', '#14B8A6',
  '#F97316', '#6B7280',
];

interface FolderModalProps {
  isOpen: boolean;
  editing?: Folder | null;
  personas: Persona[];
  onClose: () => void;
  onSave: (payload: {
    name: string;
    color: string | null;
    is_starred: boolean;
    persona_id: string | null;
  }) => Promise<void>;
}

export default function FolderModal({ isOpen, editing, personas, onClose, onSave }: FolderModalProps) {
  const [name, setName]           = useState('');
  const [color, setColor]         = useState<string>(PRESET_COLORS[0]);
  const [isStarred, setIsStarred] = useState(false);
  const [personaId, setPersonaId] = useState<string>('');
  const [isSaving, setIsSaving]   = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(editing?.name ?? '');
    setColor(editing?.color ?? PRESET_COLORS[0]);
    setIsStarred(editing?.is_starred ?? false);
    setPersonaId(editing?.persona_id ?? '');
  }, [isOpen, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        color,
        is_starred: isStarred,
        persona_id: personaId || null,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[90dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#37352F]">
            {editing ? 'Edit Folder' : 'New Folder'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#787774] hover:bg-[#EFEFED] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[#787774] mb-1.5">
              Folder name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Linear Algebra, Algorithms..."
              autoFocus
              className="w-full px-3 py-2.5 text-sm text-[#37352F] border border-[#E8E8E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors placeholder:text-[#C4C4C4]"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-xs font-medium text-[#787774] mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-100"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? `2px solid ${c}` : '2px solid transparent',
                    outlineOffset: '2px',
                    transform: color === c ? 'scale(1.15)' : 'scale(1)',
                  }}
                >
                  {color === c && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
            {/* Preview strip */}
            <div
              className="mt-2 h-1.5 rounded-full transition-colors duration-150"
              style={{ backgroundColor: color }}
            />
          </div>

          {/* Default tutor */}
          <div>
            <label className="block text-xs font-medium text-[#787774] mb-1.5">
              Default tutor <span className="text-[#C4C4C4]">(optional)</span>
            </label>
            <select
              value={personaId}
              onChange={e => setPersonaId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm text-[#37352F] border border-[#E8E8E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-colors bg-white"
            >
              <option value="">No default tutor</option>
              {personas.map(p => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Star toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none py-1">
            <div className="relative shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={isStarred}
                onChange={e => setIsStarred(e.target.checked)}
              />
              <div className="w-9 h-5 bg-[#E8E8E6] rounded-full peer peer-checked:bg-amber-400 transition-colors duration-150" />
              <div className="absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-150 peer-checked:translate-x-4" />
            </div>
            <div className="flex items-center gap-1.5">
              <Star className={`w-3.5 h-3.5 ${isStarred ? 'text-amber-400 fill-amber-400' : 'text-[#C4C4C4]'}`} />
              <span className="text-sm text-[#37352F]">Star this folder</span>
            </div>
          </label>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[#E8E8E6] text-sm font-medium text-[#787774] hover:bg-[#F7F7F5] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
