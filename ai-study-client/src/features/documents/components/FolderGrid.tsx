import FolderCard from './FolderCard';
import type { Folder } from '../hooks/useFolders';
import type { Persona } from '../../../types/persona';

interface FolderGridProps {
  folders: Folder[];
  docs: { folder_id: number | null }[];
  personas: Persona[];
  onOpen: (id: number) => void;
  onEdit: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}

export default function FolderGrid({ folders, docs, personas, onOpen, onEdit, onDelete }: FolderGridProps) {
  if (folders.length === 0) return null;

  const docCount = (folderId: number) => docs.filter(d => d.folder_id === folderId).length;
  const personaName = (personaId: string | null) =>
    personaId ? (personas.find(p => p.id === personaId)?.name ?? undefined) : undefined;

  // Starred folders first, then alphabetical
  const sorted = [...folders].sort((a, b) => {
    if (a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="mb-8">
      <p className="text-xs text-[#787774] font-semibold uppercase tracking-widest mb-3">
        Courses
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {sorted.map(folder => (
          <FolderCard
            key={folder.id}
            folder={folder}
            docCount={docCount(folder.id)}
            personaName={personaName(folder.persona_id)}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
