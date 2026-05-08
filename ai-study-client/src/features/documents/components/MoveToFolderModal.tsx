import { X, FolderMinus } from 'lucide-react';
import type { Folder } from '../hooks/useFolders';

interface MoveToFolderModalProps {
  isOpen: boolean;
  docTitle: string;
  folders: Folder[];
  currentFolderId: number | null;
  onMove: (folderId: number | null) => void;
  onClose: () => void;
}

export default function MoveToFolderModal({
  isOpen,
  docTitle,
  folders,
  currentFolderId,
  onMove,
  onClose,
}: MoveToFolderModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5 max-h-[90dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#37352F]">Move to folder</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#787774] hover:bg-[#EFEFED] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#787774] mb-3 truncate">
          <span className="font-medium text-[#37352F]">{docTitle}</span>
        </p>

        <ul className="space-y-0.5 max-h-56 overflow-y-auto -mx-1 px-1">
          {/* Unfiled */}
          <li>
            <button
              onClick={() => { onMove(null); onClose(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                currentFolderId === null
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-[#37352F] hover:bg-[#F7F7F5]'
              }`}
            >
              <FolderMinus className="w-4 h-4 text-[#787774] shrink-0" />
              Unfiled
            </button>
          </li>

          {folders.map(f => (
            <li key={f.id}>
              <button
                onClick={() => { onMove(f.id); onClose(); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  currentFolderId === f.id
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-[#37352F] hover:bg-[#F7F7F5]'
                }`}
              >
                <div
                  className="w-4 h-4 rounded-sm shrink-0"
                  style={{ backgroundColor: f.color ?? '#6366F1' }}
                />
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
        </ul>

        {folders.length === 0 && (
          <p className="text-xs text-[#787774] text-center py-4">
            No folders yet. Create one from My Library.
          </p>
        )}
      </div>
    </div>
  );
}
