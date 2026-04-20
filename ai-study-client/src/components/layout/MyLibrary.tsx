import React, { useRef, useState, useMemo } from 'react';
import {
  Upload, Globe, LockKeyhole, Trash2, Library,
  Loader2, AlertCircle, Calendar, CheckCircle2, Star,
  Search, ChevronDown, FolderPlus, ArrowLeft, MoreVertical,
  FolderOpen,
} from 'lucide-react';
import PageContainer from './PageContainer';
import PageHeader from './PageHeader';
import FolderGrid from '../../features/documents/components/FolderGrid';
import FolderModal from '../../features/documents/components/FolderModal';
import MoveToFolderModal from '../../features/documents/components/MoveToFolderModal';
import type { Folder } from '../../features/documents/hooks/useFolders';
import type { Persona } from '../../types/persona';
import { FileIcon, ACCEPTED_FILE_TYPES } from '../../utils/fileIcons';

type SortMode = 'newest' | 'name' | 'starred';

const SORT_LABELS: Record<SortMode, string> = {
  newest:  'Newest',
  name:    'Name',
  starred: 'Starred first',
};

interface Doc {
  id: number;
  title: string;
  summary: string | null;
  is_public: boolean;
  is_starred: boolean;
  folder_id: number | null;
  shared_at: string | null;
  created_at?: string | null;
}

interface MyLibraryProps {
  userDocs: Doc[];
  isUploading: boolean;
  uploadError: string | null;
  enableGlobalSummary: boolean;
  setEnableGlobalSummary: (val: boolean) => void;
  onUploadFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectDocument: (doc: { id: number }) => void;
  onDeleteRequest: (doc: { id: number; title: string }) => void;
  onToggleVisibility: (id: number) => void;
  onStarDocument: (id: number, isStarred: boolean) => void;
  onMoveDocument: (docId: number, folderId: number | null) => void;
  folders: Folder[];
  activeFolderId: number | null;
  setActiveFolderId: (id: number | null) => void;
  onCreateFolder: (p: { name: string; color: string | null; is_starred: boolean; persona_id: string | null }) => Promise<Folder>;
  onUpdateFolder: (id: number, p: { name?: string; color?: string | null; is_starred?: boolean; persona_id?: string | null }) => Promise<Folder>;
  onDeleteFolder: (id: number) => Promise<void>;
  personas: Persona[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Document card ─────────────────────────────────────────────────────────────

interface DocCardProps {
  doc: Doc;
  folders: Folder[];
  onOpen: (doc: Doc) => void;
  onDeleteRequest: (doc: { id: number; title: string }) => void;
  onToggleVisibility: (id: number) => void;
  onStarDocument: (id: number, isStarred: boolean) => void;
  onMoveDocument: (docId: number, folderId: number | null) => void;
}

function DocCard({
  doc, folders, onOpen, onDeleteRequest, onToggleVisibility, onStarDocument, onMoveDocument,
}: DocCardProps) {
  const [menuOpen, setMenuOpen]       = useState(false);
  const [showMove, setShowMove]       = useState(false);
  const menuRef                       = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const folder = doc.folder_id ? folders.find(f => f.id === doc.folder_id) : null;

  return (
    <>
      <div className="group bg-white border border-[#E8E8E6] rounded-xl p-5 shadow-sm flex flex-col gap-3 hover:border-[#C4C4C4] hover:shadow-md transition-all duration-150">

        {/* Thumbnail + title */}
        <div className="flex items-start gap-3 cursor-pointer" onClick={() => onOpen(doc)}>
          <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center shrink-0 mt-0.5">
            <FileIcon filename={doc.title} className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[#37352F] leading-snug line-clamp-2">{doc.title}</h3>
            {doc.summary && (
              <p className="text-xs text-[#787774] mt-1 line-clamp-2 leading-relaxed">{doc.summary}</p>
            )}
            {folder && (
              <div className="flex items-center gap-1 mt-1.5">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: folder.color ?? '#6366F1' }}
                />
                <span className="text-[10px] text-[#787774] truncate">{folder.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-[#E8E8E6]">
          {/* Visibility pill */}
          <button
            onClick={e => { e.stopPropagation(); onToggleVisibility(doc.id); }}
            title={doc.is_public ? 'Public — click to make private' : 'Private — click to publish'}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border transition-colors duration-150 ${
              doc.is_public
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-white text-[#787774] border-[#E8E8E6] hover:bg-[#EFEFED]'
            }`}
          >
            {doc.is_public
              ? <><Globe className="w-3 h-3" />Public</>
              : <><LockKeyhole className="w-3 h-3" />Private</>
            }
          </button>

          <div className="flex items-center gap-0.5">
            {(doc.shared_at || doc.created_at) && (
              <span className="flex items-center gap-1 text-xs text-[#C4C4C4] me-1">
                <Calendar className="w-3 h-3" />
                {formatDate(doc.shared_at ?? doc.created_at)}
              </span>
            )}

            {/* Star */}
            <button
              onClick={e => { e.stopPropagation(); onStarDocument(doc.id, !doc.is_starred); }}
              title={doc.is_starred ? 'Remove star' : 'Star this document'}
              className="p-1.5 rounded-md hover:bg-amber-50 transition-colors duration-150"
            >
              <Star
                className={`w-3.5 h-3.5 transition-colors ${
                  doc.is_starred ? 'text-amber-400 fill-amber-400' : 'text-[#C4C4C4] hover:text-amber-300'
                }`}
              />
            </button>

            {/* Open */}
            <button
              onClick={() => onOpen(doc)}
              className="text-xs font-medium text-[#787774] hover:text-indigo-600 px-2 py-1 rounded-md hover:bg-indigo-50 transition-colors duration-150"
            >
              Open
            </button>

            {/* 3-dot menu */}
            <div ref={menuRef} className="relative">
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-[#C4C4C4] hover:text-[#787774] hover:bg-[#EFEFED] transition-all duration-150"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>

              {menuOpen && (
                <div className="absolute bottom-full right-0 mb-1 w-40 bg-white rounded-lg border border-[#E8E8E6] shadow-lg z-50 overflow-hidden">
                  <button
                    onClick={e => { e.stopPropagation(); setShowMove(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#37352F] hover:bg-[#F7F7F5] transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#787774]" />
                    Move to…
                  </button>
                  <div className="h-px bg-[#E8E8E6] mx-2" />
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteRequest(doc); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <MoveToFolderModal
        isOpen={showMove}
        docTitle={doc.title}
        folders={folders}
        currentFolderId={doc.folder_id}
        onMove={folderId => onMoveDocument(doc.id, folderId)}
        onClose={() => setShowMove(false)}
      />
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MyLibrary({
  userDocs,
  isUploading,
  uploadError,
  enableGlobalSummary,
  setEnableGlobalSummary,
  onUploadFile,
  onSelectDocument,
  onDeleteRequest,
  onToggleVisibility,
  onStarDocument,
  onMoveDocument,
  folders,
  activeFolderId,
  setActiveFolderId,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  personas,
}: MyLibraryProps) {
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const sortMenuRef                           = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery]         = useState('');
  const [sortMode, setSortMode]               = useState<SortMode>('newest');
  const [sortMenuOpen, setSortMenuOpen]       = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder]     = useState<Folder | null>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const activeFolder = activeFolderId != null ? folders.find(f => f.id === activeFolderId) : null;

  // Filter: at root show unfiled docs; inside a folder show that folder's docs
  const visibleDocs = useMemo(() => {
    let list = activeFolderId != null
      ? userDocs.filter(d => d.folder_id === activeFolderId)
      : userDocs.filter(d => d.folder_id === null);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => d.title.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      if (sortMode === 'newest') {
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      }
      if (sortMode === 'name')    return a.title.localeCompare(b.title);
      if (sortMode === 'starred') return (b.is_starred ? 1 : 0) - (a.is_starred ? 1 : 0);
      return 0;
    });
  }, [userDocs, activeFolderId, searchQuery, sortMode]);

  // ── Header actions ───────────────────────────────────────────────────────

  const headerActions = (
    <>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <div className="relative">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enableGlobalSummary}
            onChange={e => setEnableGlobalSummary(e.target.checked)}
          />
          <div className="w-8 h-4 bg-[#E8E8E6] rounded-full peer peer-checked:bg-indigo-600 transition-colors duration-150" />
          <div className="absolute top-0.5 start-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-150 peer-checked:translate-x-4" />
        </div>
        <span className="text-xs text-[#787774]">Auto-summarize</span>
      </label>

      <label
        className={`flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-150 cursor-pointer ${
          isUploading ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''
        }`}
      >
        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {isUploading ? 'Uploading…' : 'Upload'}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={onUploadFile}
          disabled={isUploading}
        />
      </label>
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        title="My Library"
        subtitle="Your academic documents and courses."
        icon={<Library className="w-5 h-5 text-indigo-600" />}
        actions={headerActions}
      />

      {/* Upload status banners */}
      {uploadError === 'DOCUMENT_EXISTS' && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-xl text-sm text-sky-900 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="font-semibold text-sky-900">Already in your library</p>
            <p className="text-sky-700 mt-0.5 text-xs leading-relaxed">
              This document is already in your library — no need to upload it again!
            </p>
          </div>
        </div>
      )}
      {uploadError && uploadError !== 'DOCUMENT_EXISTS' && (
        <div className="mb-6 flex items-start gap-2.5 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Upload failed. Please check the file and try again.</span>
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#C4C4C4] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search documents…"
            className="w-full pl-8 pr-3 py-2 text-sm text-[#37352F] border border-[#E8E8E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors placeholder:text-[#C4C4C4]"
          />
        </div>

        {/* Sort dropdown */}
        <div ref={sortMenuRef} className="relative">
          <button
            onClick={() => setSortMenuOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#787774] border border-[#E8E8E6] rounded-lg hover:bg-[#F7F7F5] transition-colors"
          >
            {SORT_LABELS[sortMode]}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${sortMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {sortMenuOpen && (
            <div className="absolute top-full mt-1 right-0 w-40 bg-white rounded-lg border border-[#E8E8E6] shadow-lg z-50 overflow-hidden">
              {(Object.entries(SORT_LABELS) as [SortMode, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setSortMode(key); setSortMenuOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    sortMode === key
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-[#37352F] hover:bg-[#F7F7F5]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New Folder — hidden when inside a folder */}
        {activeFolderId == null && (
          <button
            onClick={() => { setEditingFolder(null); setFolderModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#787774] border border-[#E8E8E6] rounded-lg hover:bg-[#F7F7F5] transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            New folder
          </button>
        )}
      </div>

      {/* ── Uploading spinner ────────────────────────────────────────────── */}
      {isUploading && (
        <div className="flex items-center justify-center py-16 gap-3 text-[#787774]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Processing document…</span>
        </div>
      )}

      {!isUploading && (
        <>
          {/* ── Folder breadcrumb ─────────────────────────────────────── */}
          {activeFolderId != null && activeFolder && (
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() => setActiveFolderId(null)}
                className="flex items-center gap-1.5 text-sm text-[#787774] hover:text-[#37352F] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                My Library
              </button>
              <span className="text-[#C4C4C4]">/</span>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: activeFolder.color ?? '#6366F1' }}
                />
                <span className="text-sm font-semibold text-[#37352F]">{activeFolder.name}</span>
              </div>
            </div>
          )}

          {/* ── Folders section (root only) ───────────────────────────── */}
          {activeFolderId == null && (
            <FolderGrid
              folders={folders}
              docs={userDocs}
              personas={personas}
              onOpen={setActiveFolderId}
              onEdit={folder => { setEditingFolder(folder); setFolderModalOpen(true); }}
              onDelete={folder => onDeleteFolder(folder.id)}
            />
          )}

          {/* ── Documents section ─────────────────────────────────────── */}
          <div>
            <p className="text-xs text-[#787774] font-semibold uppercase tracking-widest mb-3">
              {activeFolderId != null
                ? `Files in ${activeFolder?.name ?? 'folder'}`
                : folders.length > 0
                  ? 'Unfiled documents'
                  : 'Documents'
              }
              {visibleDocs.length > 0 && (
                <span className="ms-2 font-normal normal-case tracking-normal">
                  ({visibleDocs.length})
                </span>
              )}
            </p>

            {/* Empty state */}
            {visibleDocs.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-[#787774]">
                {searchQuery ? (
                  <>
                    <Search className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No results for "{searchQuery}"</p>
                  </>
                ) : activeFolderId != null ? (
                  <>
                    <FolderOpen className="w-8 h-8 opacity-30" />
                    <p className="text-sm">This folder is empty.</p>
                    <label className="mt-1 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Upload a document
                      <input type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={onUploadFile} />
                    </label>
                  </>
                ) : (
                  <>
                    <Library className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No documents yet. Upload a PDF to get started.</p>
                    <label className="mt-1 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Upload Document
                      <input type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={onUploadFile} />
                    </label>
                  </>
                )}
              </div>
            )}

            {/* Document grid */}
            {visibleDocs.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleDocs.map(doc => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    folders={folders}
                    onOpen={d => onSelectDocument({ id: d.id })}
                    onDeleteRequest={onDeleteRequest}
                    onToggleVisibility={onToggleVisibility}
                    onStarDocument={onStarDocument}
                    onMoveDocument={onMoveDocument}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Folder create / edit modal */}
      <FolderModal
        isOpen={folderModalOpen}
        editing={editingFolder}
        personas={personas}
        onClose={() => { setFolderModalOpen(false); setEditingFolder(null); }}
        onSave={async payload => {
          if (editingFolder) {
            await onUpdateFolder(editingFolder.id, payload);
          } else {
            await onCreateFolder(payload);
          }
        }}
      />
    </PageContainer>
  );
}
