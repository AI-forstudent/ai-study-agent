import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FileText, Trash2 } from 'lucide-react';

interface Doc {
  id: number;
  title: string;
}

interface DocumentPickerProps {
  docs: Doc[];
  selectedId: number | null;
  onSelect: (doc: Doc) => void;
  onDeleteRequest: (doc: Doc) => void;
}

const DocumentPicker: React.FC<DocumentPickerProps> = ({ docs, selectedId, onSelect, onDeleteRequest }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedDoc = docs.find(d => d.id === selectedId);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1.5 focus:outline-none cursor-pointer w-44"
      >
        <span className="flex-1 text-sm font-bold text-blue-600 truncate text-right">
          {selectedDoc ? selectedDoc.title : 'בחר מסמך...'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 flex-shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-[100] overflow-hidden">
          {docs.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400 text-center">אין מסמכים עדיין</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {docs.map(doc => (
                <li
                  key={doc.id}
                  className="group flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 cursor-pointer"
                  onClick={() => { onSelect(doc); setIsOpen(false); }}
                >
                  <FileText
                    className={`w-4 h-4 flex-shrink-0 ${doc.id === selectedId ? 'text-blue-500' : 'text-slate-400'}`}
                  />
                  <span
                    className={`flex-1 text-sm truncate ${doc.id === selectedId ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                  >
                    {doc.title}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteRequest(doc);
                      setIsOpen(false);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                    title="מחק מסמך"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentPicker;
