import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Search, Library, FileText, User, Calendar,
  BookOpen, X, Plus, CheckCircle, Loader2, LogIn, Globe,
} from 'lucide-react';
import { api } from '../../../services/api';
import PageContainer from '../../../components/layout/PageContainer';
import PageHeader from '../../../components/layout/PageHeader';

interface PublicDoc {
  id: number;
  title: string;
  summary: string | null;
  is_public: boolean;
  shared_at: string | null;
  owner_email: string;
}

interface PublicGalleryProps {
  isAuthenticated: boolean;
  onBack: () => void;
  onGetStarted: () => void;
  /** When true: hides the standalone top bar (sidebar handles navigation) */
  inAppLayout?: boolean;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Preview slide-over panel ────────────────────────────────────────────────
interface PreviewPanelProps {
  doc: PublicDoc;
  isAuthenticated: boolean;
  clonedIds: Set<number>;
  onClone: (doc: PublicDoc) => void;
  onClose: () => void;
  onGetStarted: () => void;
}

function PreviewPanel({ doc, isAuthenticated, clonedIds, onClone, onClose, onGetStarted }: PreviewPanelProps) {
  const cloned = clonedIds.has(doc.id);

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/20 z-40 transition-opacity"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col">

        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div className="flex-1 pr-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 mb-1">Document Preview</p>
            <h2 className="text-lg font-bold text-slate-900 leading-snug">{doc.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 flex items-center gap-5 border-b border-slate-100 text-sm text-slate-500">
          <span className="flex items-center gap-1.5">
            <User className="w-4 h-4" />
            {doc.owner_email}
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            {formatDate(doc.shared_at)}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {doc.summary ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Document Summary</p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{doc.summary}</p>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-3">
              <FileText className="w-10 h-10 opacity-30" />
              <p className="text-sm">No summary available for this document.</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100">
          {isAuthenticated ? (
            <button
              onClick={() => onClone(doc)}
              disabled={cloned}
              className={`w-full flex items-center justify-center gap-2 font-bold py-3.5 rounded-xl transition-all text-sm ${
                cloned
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                  : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0'
              }`}
            >
              {cloned ? (
                <><CheckCircle className="w-4 h-4" /> Added to library</>
              ) : (
                <><Plus className="w-4 h-4" /> Add to my library</>
              )}
            </button>
          ) : (
            <div className="space-y-2 text-center">
              <p className="text-xs text-slate-500">Sign in to clone this document to your library.</p>
              <button
                onClick={onGetStarted}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold py-3.5 rounded-xl shadow-md shadow-indigo-200 hover:-translate-y-0.5 transition-all text-sm"
              >
                <LogIn className="w-4 h-4" />
                Sign in to clone
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Document card ───────────────────────────────────────────────────────────
interface CardProps {
  doc: PublicDoc;
  isAuthenticated: boolean;
  clonedIds: Set<number>;
  onPreview: (doc: PublicDoc) => void;
  onClone: (doc: PublicDoc) => void;
  onGetStarted: () => void;
}

function DocCard({ doc, isAuthenticated, clonedIds, onPreview, onClone, onGetStarted }: CardProps) {
  const cloned = clonedIds.has(doc.id);

  return (
    <div className="bg-white border border-[#E8E8E6] rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-slate-200 transition-all duration-200 flex flex-col gap-4">

      <div>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <FileText className="w-4 h-4 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 cursor-pointer hover:text-indigo-600 transition-colors"
              onClick={() => onPreview(doc)}
            >
              {doc.title}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 truncate">{doc.owner_email}</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 flex-1">
        {doc.summary ?? 'No summary available for this document.'}
      </p>

      <div className="flex items-center justify-between pt-1 border-t border-slate-50">
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <Calendar className="w-3.5 h-3.5" />
          {formatDate(doc.shared_at)}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPreview(doc)}
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-all"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Preview
          </button>
          {isAuthenticated ? (
            <button
              onClick={() => onClone(doc)}
              disabled={cloned}
              className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all ${
                cloned
                  ? 'text-emerald-600 bg-emerald-50 cursor-default'
                  : 'text-indigo-600 hover:bg-indigo-50'
              }`}
            >
              {cloned
                ? <><CheckCircle className="w-3.5 h-3.5" /> Added</>
                : <><Plus className="w-3.5 h-3.5" /> Add</>
              }
            </button>
          ) : (
            <button
              onClick={onGetStarted}
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-all"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function PublicGallery({ isAuthenticated, onBack, onGetStarted, inAppLayout = false }: PublicGalleryProps) {
  const [docs, setDocs]           = useState<PublicDoc[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [search, setSearch]       = useState('');
  const [preview, setPreview]     = useState<PublicDoc | null>(null);
  const [clonedIds, setClonedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.getPublicDocuments()
      .then(res => setDocs(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return docs;
    return docs.filter(d =>
      d.title.toLowerCase().includes(q) ||
      (d.summary ?? '').toLowerCase().includes(q) ||
      d.owner_email.toLowerCase().includes(q)
    );
  }, [docs, search]);

  function handleClone(doc: PublicDoc) {
    console.log('INTENT: clone document', { id: doc.id, title: doc.title });
    setClonedIds(prev => new Set(prev).add(doc.id));
  }

  const searchBar = (
    <div className="relative w-64">
      <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C4C4C4] pointer-events-none" />
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by title, author…"
        className="w-full bg-white border border-[#E8E8E6] rounded-lg ps-9 pe-4 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
      />
    </div>
  );

  return (
    <div className={`w-full flex flex-col ${inAppLayout ? 'h-full' : 'min-h-screen bg-[#F7F7F5]'}`} dir="ltr">

      {!inAppLayout && (
        <header className="bg-white border-b border-[#E8E8E6] sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-1.5 rounded-md text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150"
                title="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Library className="w-4 h-4 text-violet-600" />
                </div>
                <span className="text-sm font-semibold text-[#37352F]">Community Library</span>
              </div>
            </div>
            {!isAuthenticated && (
              <button
                onClick={onGetStarted}
                className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-100 transition-colors duration-150"
              >
                <LogIn className="w-4 h-4" />
                Sign in
              </button>
            )}
          </div>
        </header>
      )}

      <PageContainer>
        <PageHeader
          title="Community Library"
          subtitle="Explore processed academic documents shared by the community."
          icon={<Globe className="w-5 h-5 text-indigo-600" />}
          actions={searchBar}
        />

        {loading && (
          <div className="flex items-center justify-center py-24 gap-3 text-[#787774]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading library…</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-[#787774]">
            <Library className="w-8 h-8 opacity-40" />
            <p className="text-sm">Could not load the library. Please try again.</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-[#787774]">
            <Library className="w-8 h-8 opacity-40" />
            <p className="text-sm">
              {search ? 'No documents match your search.' : 'No public documents yet. Be the first to share!'}
            </p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <p className="text-xs text-[#787774] font-medium mb-4">
              {filtered.length} document{filtered.length !== 1 ? 's' : ''}
              {search && ' matching your search'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {filtered.map(doc => (
                <DocCard
                  key={doc.id}
                  doc={doc}
                  isAuthenticated={isAuthenticated}
                  clonedIds={clonedIds}
                  onPreview={setPreview}
                  onClone={handleClone}
                  onGetStarted={onGetStarted}
                />
              ))}
            </div>
          </>
        )}
      </PageContainer>

      {preview && (
        <PreviewPanel
          doc={preview}
          isAuthenticated={isAuthenticated}
          clonedIds={clonedIds}
          onClone={handleClone}
          onClose={() => setPreview(null)}
          onGetStarted={onGetStarted}
        />
      )}
    </div>
  );
}
