import { useState, useRef, useEffect } from 'react';
import { FolderOpen, Star, MoreVertical, Pencil, Trash2, Bot } from 'lucide-react';
import type { Folder } from '../hooks/useFolders';

export type { Folder };

interface FolderCardProps {
  folder: Folder;
  docCount: number;
  personaName?: string;
  onOpen: (id: number) => void;
  onEdit: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}

export default function FolderCard({ folder, docCount, personaName, onOpen, onEdit, onDelete }: FolderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const color = folder.color ?? '#6366F1';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div
      className="group relative bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer overflow-hidden"
      style={{
        border: '1px solid #E8E8E6',
        borderLeft: `4px solid ${color}`,
      }}
      onClick={() => onOpen(folder.id)}
    >
      <div className="p-4">
        {/* Folder icon */}
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
          style={{ backgroundColor: `${color}20` }}
        >
          <FolderOpen className="w-4.5 h-4.5" style={{ color }} />
        </div>

        {/* Name + star */}
        <div className="flex items-center gap-1 mb-1.5 min-w-0">
          <p className="flex-1 text-sm font-semibold text-[#37352F] truncate">{folder.name}</p>
          {folder.is_starred && (
            <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-[#787774]">
            {docCount} {docCount === 1 ? 'file' : 'files'}
          </span>
          {personaName && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">
              <Bot className="w-2.5 h-2.5" />
              {personaName}
            </span>
          )}
        </div>
      </div>

      {/* 3-dot menu — top-right corner, appears on hover */}
      <div
        ref={menuRef}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-100"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="p-1 rounded-md text-[#C4C4C4] hover:text-[#787774] hover:bg-white/80"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute top-full right-0 mt-1 w-36 bg-white rounded-lg border border-[#E8E8E6] shadow-lg z-50 overflow-hidden">
            <button
              onClick={() => { onEdit(folder); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#37352F] hover:bg-[#F7F7F5] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-[#787774]" />
              Edit
            </button>
            <button
              onClick={() => { onDelete(folder); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
