import { useState } from 'react';
import {
  Wand2, Star, X, Copy, BookOpen, Tag, UserCircle, Users,
  Zap, Search, Pencil, Trash2, Play, Plus, FileText,
} from 'lucide-react';
import type { Persona, PersonaType, TagCategory } from '../../../types/persona';
import { useAppStore } from '../../../store/useAppStore';
import PageContainer from '../../../components/layout/PageContainer';
import PageHeader from '../../../components/layout/PageHeader';
import PersonaEditor from './PersonaEditor';

// ── Props ──────────────────────────────────────────────────────────────────

interface PersonaLabProps {
  onBack: () => void;
  onStartWithPersona?: (personaId: string) => void;
}

// ── Tabs ───────────────────────────────────────────────────────────────────

type TabId = 'store' | 'community' | 'personal';

interface Tab {
  id: TabId;
  label: string;
  type: PersonaType;
}

const TABS: Tab[] = [
  { id: 'store',     label: 'Store',       type: 'global'    },
  { id: 'community', label: 'Community',   type: 'community' },
  { id: 'personal',  label: 'My Personas', type: 'personal'  },
];

const MOCK_DOC_TITLES: Record<number, string> = {
  1:  'PostgreSQL 16 Internals',
  2:  'Operating Systems — Course Notes',
  3:  'pgvector Documentation',
  4:  'Computer Networks — BGU Slides',
  5:  'Compiler Theory Lecture Notes',
  6:  'Israeli Political System — Readings',
  10: 'Data Structures Course Slides',
  11: 'Algorithm Design Manual',
  12: 'Linear Algebra (Friedberg)',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatWordCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k words`;
  return `${n} words`;
}

function getContextDepth(wordCount: number): { label: string; classes: string } {
  if (wordCount >= 500) return { label: 'Deep Context',   classes: 'text-indigo-600 bg-indigo-50 border-indigo-200' };
  if (wordCount >= 200) return { label: 'Medium Context', classes: 'text-amber-600 bg-amber-50 border-amber-200' };
  return                       { label: 'Light Context',  classes: 'text-[#787774] bg-[#F7F7F5] border-[#E8E8E6]' };
}

function getTagClasses(tag: string, tagTypes?: Record<string, TagCategory>): string {
  const category = tagTypes?.[tag];
  switch (category) {
    case 'knowledge':    return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'personality':  return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'instructions': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'extra':        return 'bg-green-50 text-green-700 border-green-200';
    case 'style':        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    default:             return 'bg-[#F7F7F5] text-[#787774] border-[#E8E8E6]';
  }
}

// ── Persona card ───────────────────────────────────────────────────────────

interface PersonaCardProps {
  persona: Persona;
  onClick: (p: Persona) => void;
  onEdit?: (p: Persona) => void;
  onPlay?: (p: Persona) => void;
  onCloneEdit?: (p: Persona) => void;
}

function PersonaCard({ persona, onClick, onEdit, onPlay, onCloneEdit }: PersonaCardProps) {
  const depth       = getContextDepth(persona.wordCount);
  const hasOverlay  = !!(onEdit || onPlay || onCloneEdit);

  return (
    <div
      onClick={() => onClick(persona)}
      className="relative group bg-white border border-[#E8E8E6] rounded-2xl p-5 cursor-pointer hover:border-[#C4C4C4] hover:shadow-sm transition-all duration-150 flex flex-col gap-3"
    >
      {hasOverlay && (
        <div className="absolute inset-0 rounded-2xl bg-white/88 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-3 z-10">
          {onPlay && (
            <button
              onClick={e => { e.stopPropagation(); onPlay(persona); }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-[#E8E8E6] rounded-lg text-[#37352F] hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all duration-150"
            >
              <Play className="w-3.5 h-3.5" />
              Start Session
            </button>
          )}
          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(persona); }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-[#E8E8E6] rounded-lg text-[#37352F] hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all duration-150"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          )}
          {onCloneEdit && (
            <button
              onClick={e => { e.stopPropagation(); onCloneEdit(persona); }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-[#E8E8E6] rounded-lg text-[#37352F] hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all duration-150"
            >
              <Copy className="w-3.5 h-3.5" />
              Clone &amp; Edit
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#F7F7F5] border border-[#E8E8E6] flex items-center justify-center shrink-0 text-xl leading-none select-none">
          {persona.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#37352F] leading-snug truncate">{persona.name}</p>
          <p className="text-xs text-[#787774] mt-0.5 truncate">{persona.author}</p>
        </div>
      </div>

      <p className="text-xs text-[#787774] leading-relaxed line-clamp-2 flex-1">
        {persona.description}
      </p>

      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${depth.classes}`}>
          {depth.label} · {formatWordCount(persona.wordCount)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {persona.tags.slice(0, 3).map(tag => (
          <span
            key={tag}
            className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${getTagClasses(tag, persona.tagTypes)}`}
          >
            {tag}
          </span>
        ))}
        {persona.tags.length > 3 && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#F7F7F5] text-[#C4C4C4] border border-[#E8E8E6]">
            +{persona.tags.length - 3}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[#E8E8E6]">
        {persona.rating > 0 ? (
          <span className="flex items-center gap-1 text-xs text-[#787774]">
            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            {persona.rating.toFixed(1)}
            <span className="text-[#C4C4C4]">({persona.reviewsCount})</span>
          </span>
        ) : (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100">
            Personal
          </span>
        )}
        <span className="flex items-center gap-1 text-xs text-[#C4C4C4]">
          <Users className="w-3 h-3" />
          {formatCount(persona.usageCount)}
        </span>
      </div>
    </div>
  );
}

// ── Preview slide-over panel ───────────────────────────────────────────────

interface PreviewPanelProps {
  persona: Persona;
  activeTab: TabId;
  onClose: () => void;
  onEdit: (p: Persona) => void;
  onDelete: (p: Persona) => void;
  onCloneEdit: (p: Persona) => void;
  onStartWithPersona?: (personaId: string) => void;
}

function PreviewPanel({ persona, activeTab, onClose, onEdit, onDelete, onCloneEdit, onStartWithPersona }: PreviewPanelProps) {
  const isPersonal = activeTab === 'personal';
  const depth      = getContextDepth(persona.wordCount);

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/20 z-40 transition-opacity"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-full max-w-[480px] bg-white shadow-xl border-s border-[#E8E8E6] z-50 flex flex-col">

        <div className="flex items-start justify-between p-6 border-b border-[#E8E8E6]">
          <div className="flex items-center gap-3 flex-1 min-w-0 pe-4">
            <div className="w-11 h-11 rounded-xl bg-[#F7F7F5] border border-[#E8E8E6] flex items-center justify-center shrink-0 text-2xl leading-none select-none">
              {persona.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-0.5">
                {persona.type === 'global' ? 'Global Persona' : persona.type === 'community' ? 'Community Persona' : 'Personal Persona'}
              </p>
              <h2 className="text-base font-bold text-[#37352F] leading-snug truncate">
                {persona.name}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 flex items-center gap-4 border-b border-[#E8E8E6] text-xs text-[#787774] flex-wrap">
          <span className="flex items-center gap-1.5">
            <UserCircle className="w-3.5 h-3.5" />
            {persona.author}
          </span>
          {persona.communityId && (
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {persona.communityId}
            </span>
          )}
          {persona.rating > 0 && (
            <span className="flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              {persona.rating.toFixed(1)} · {persona.reviewsCount} reviews
            </span>
          )}
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${depth.classes}`}>
            {depth.label} · {formatWordCount(persona.wordCount)}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2">About</p>
            <p className="text-sm text-[#787774] leading-relaxed">{persona.description}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2 flex items-center gap-1.5">
              <Tag className="w-3 h-3" /> Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {persona.tags.map(tag => (
                <span
                  key={tag}
                  className={`text-xs font-medium px-2.5 py-1 rounded-md border ${getTagClasses(tag, persona.tagTypes)}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#C4C4C4]">
                Knowledge Base
              </p>
              <button
                onClick={() => console.log('INTENT: link document to persona', { personaId: persona.id })}
                className="flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-colors duration-150"
              >
                <Plus className="w-3 h-3" />
                Link doc
              </button>
            </div>
            {persona.linkedDocIds.length === 0 ? (
              <p className="text-xs text-[#C4C4C4] italic">No documents linked yet.</p>
            ) : (
              <div className="space-y-1.5">
                {persona.linkedDocIds.map(docId => {
                  const title = MOCK_DOC_TITLES[docId] ?? `Document #${docId}`;
                  return (
                    <div
                      key={docId}
                      className="flex items-center gap-2 px-3 py-2 bg-[#F7F7F5] border border-[#E8E8E6] rounded-lg"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#787774] shrink-0" />
                      <span className="text-xs text-[#37352F] truncate">{title}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#C4C4C4] mb-2">System Prompt</p>
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 max-h-64 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed font-mono">
                {persona.systemPrompt}
              </pre>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#E8E8E6] flex flex-col gap-2">
          {isPersonal ? (
            <>
              <button
                onClick={() => onEdit(persona)}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                <Pencil className="w-4 h-4" />
                Edit Persona
              </button>
              <button
                onClick={() => onDelete(persona)}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-red-50 text-red-600 text-sm font-medium py-2.5 rounded-lg border border-red-200 hover:border-red-300 transition-colors duration-150"
              >
                <Trash2 className="w-4 h-4" />
                Delete Persona
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onCloneEdit(persona)}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors duration-150"
              >
                <Copy className="w-4 h-4" />
                Clone &amp; Edit
              </button>
              <button
                onClick={() => onStartWithPersona?.(persona.id)}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-[#F7F7F5] text-[#37352F] text-sm font-medium py-2.5 rounded-lg border border-[#E8E8E6] transition-colors duration-150"
              >
                <BookOpen className="w-4 h-4" />
                Use for Session
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const PersonaLab: React.FC<PersonaLabProps> = ({ onStartWithPersona }) => {
  const personas       = useAppStore(state => state.personas);
  const createPersona  = useAppStore(state => state.createPersona);
  const updatePersona  = useAppStore(state => state.updatePersona);
  const deletePersona  = useAppStore(state => state.deletePersona);

  const [activeTab, setActiveTab]             = useState<TabId>('store');
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [search, setSearch]                   = useState('');
  const [flexibleSearch, setFlexibleSearch]   = useState(false);
  const [editorState, setEditorState]         = useState<{ persona: Persona; mode: 'edit' | 'clone' } | null>(null);

  const activeType: PersonaType = TABS.find(t => t.id === activeTab)!.type;

  const filtered = personas.filter(p => {
    if (p.type !== activeType) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    const inBasic = (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
    if (inBasic) return true;
    if (flexibleSearch) return p.systemPrompt.toLowerCase().includes(q);
    return false;
  });

  function handleTabChange(id: TabId) {
    setActiveTab(id);
    setSearch('');
    setSelectedPersona(null);
    setEditorState(null);
  }

  function handleEditPersona(persona: Persona) {
    setSelectedPersona(null);
    setEditorState({ persona, mode: 'edit' });
  }

  function handleCloneAndEdit(persona: Persona) {
    setSelectedPersona(null);
    setEditorState({ persona, mode: 'clone' });
  }

  function handlePlayPersona(persona: Persona) {
    onStartWithPersona?.(persona.id);
  }

  function handleDeletePersona(persona: Persona) {
    void deletePersona(persona.id);
    setSelectedPersona(null);
  }

  function handleEditorSave(updated: Persona, transient: boolean) {
    if (!transient && editorState?.mode === 'clone') {
      void createPersona(updated).then(saved => {
        if (saved) setActiveTab('personal');
        setEditorState(null);
      });
      return;
    }
    if (!transient && editorState?.mode === 'edit') {
      void updatePersona(updated.id, updated).then(() => setEditorState(null));
      return;
    }
    setEditorState(null);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Persona Hub"
        subtitle="Discover, clone, and manage AI study agents."
        icon={<Wand2 className="w-5 h-5 text-indigo-600" />}
      />

      <div className="flex border-b border-[#E8E8E6] -mt-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-[#787774] hover:text-[#37352F]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5 mb-5">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C4C4C4] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search personas by name, description, or tag…"
            className="w-full bg-white border border-[#E8E8E6] rounded-lg ps-9 pe-4 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={flexibleSearch}
              onChange={e => setFlexibleSearch(e.target.checked)}
            />
            <div className="w-8 h-4 bg-[#E8E8E6] rounded-full peer peer-checked:bg-indigo-600 transition-colors duration-150" />
            <div className="absolute top-0.5 start-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-150 peer-checked:translate-x-4" />
          </div>
          <span className="text-xs text-[#787774]">Flexible Search</span>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-[#787774]">
          <Zap className="w-8 h-8 opacity-30" />
          <p className="text-sm">
            {search ? 'No personas match your search.' : 'No personas here yet.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-[#787774] font-medium mb-4">
            {filtered.length} persona{filtered.length !== 1 ? 's' : ''}
            {search && ' matching your search'}
            {flexibleSearch && search && (
              <span className="ms-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100">
                flexible
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(persona => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                onClick={setSelectedPersona}
                onPlay={handlePlayPersona}
                onEdit={activeTab === 'personal'  ? handleEditPersona  : undefined}
                onCloneEdit={activeTab !== 'personal' ? handleCloneAndEdit : undefined}
              />
            ))}
          </div>
        </>
      )}

      {selectedPersona && (
        <PreviewPanel
          persona={selectedPersona}
          activeTab={activeTab}
          onClose={() => setSelectedPersona(null)}
          onEdit={handleEditPersona}
          onDelete={handleDeletePersona}
          onCloneEdit={handleCloneAndEdit}
          onStartWithPersona={onStartWithPersona}
        />
      )}

      {editorState && (
        <PersonaEditor
          persona={editorState.persona}
          mode={editorState.mode}
          inSession={false}
          onClose={() => setEditorState(null)}
          onSave={handleEditorSave}
        />
      )}
    </PageContainer>
  );
};

export default PersonaLab;
