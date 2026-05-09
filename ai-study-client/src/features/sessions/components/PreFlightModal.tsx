import React, { useState, useEffect, useRef } from 'react';
import { X, Play, Clock, FileText, Upload, BookOpen, Sparkles, Info } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

// ── Props ──────────────────────────────────────────────────────────────────

interface PreFlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'from-doc': user opened a doc → picks a persona. 'from-persona': user picked a persona → picks a doc. */
  mode?: 'from-doc' | 'from-persona';
  /** In from-doc mode: the document being opened */
  documentName?: string;
  /** In from-doc mode: the ID of the document being opened (used to detect session match) */
  openedDocumentId?: number | null;
  /** In from-persona mode: persona that was already chosen */
  preSelectedPersonaId?: string | null;
  /** Used in from-persona mode to list recent documents */
  userDocs?: { id: number; title: string }[];
  /** Called when user selects a file in the upload input (from-persona mode) */
  onFileInputChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Called when session is confirmed */
  onStartSession: (personaId: string | null, documentId: number | null) => void;
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
      className={`flex-shrink-0 w-[90px] flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150 text-start ${
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

// ── Document list item ─────────────────────────────────────────────────────

interface DocItemProps {
  title: string;
  isSelected: boolean;
  onClick: () => void;
}

function DocItem({ title, isSelected, onClick }: DocItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-150 text-start ${
        isSelected
          ? 'border-indigo-300 bg-indigo-50'
          : 'border-[#E8E8E6] bg-white hover:border-[#C4C4C4] hover:bg-[#F7F7F5]'
      }`}
    >
      <FileText className={`w-4 h-4 shrink-0 ${isSelected ? 'text-indigo-500' : 'text-[#C4C4C4]'}`} />
      <span className={`text-sm truncate ${isSelected ? 'text-indigo-700 font-medium' : 'text-[#37352F]'}`}>
        {title}
      </span>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PreFlightModal({
  isOpen,
  onClose,
  mode = 'from-doc',
  documentName,
  openedDocumentId,
  preSelectedPersonaId,
  userDocs = [],
  onFileInputChange,
  onStartSession,
}: PreFlightModalProps) {
  const personas      = useAppStore(state => state.personas);
  const activeSession = useAppStore(state => state.activeSession);

  const personalPersonas = personas.filter(p => p.type === 'personal');

  const lastSessionPersonaId = activeSession?.personaId ?? null;
  const lastSessionPersona   = lastSessionPersonaId
    ? personas.find(p => p.id === lastSessionPersonaId) ?? null
    : null;

  const isSameSessionDoc = !!activeSession && openedDocumentId != null
    && activeSession.documentId === openedDocumentId;

  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setSelectedPersonaId(null);
      setSelectedDocId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedPersona = selectedPersonaId
    ? personas.find(p => p.id === selectedPersonaId)
    : null;

  const effectivePersonaId = mode === 'from-persona' ? (preSelectedPersonaId ?? null) : selectedPersonaId;

  const preSelectedPersona = preSelectedPersonaId
    ? personas.find(p => p.id === preSelectedPersonaId)
    : null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.[0]) return;
    onFileInputChange?.(e);
    onStartSession(effectivePersonaId, null);
  }

  // ── Shared header + backdrop wrapper ──────────────────────────────────────
  const wrapModal = (children: React.ReactNode) => (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      dir="ltr"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col border border-[#E8E8E6] max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  // ── From-persona mode ──────────────────────────────────────────────────────
  if (mode === 'from-persona') {
    return wrapModal(
      <>
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-base font-bold text-[#37352F]">Start Study Session</h2>
            {preSelectedPersona && (
              <p className="text-xs text-[#787774] mt-1 flex items-center gap-1.5">
                <span className="text-base leading-none">{preSelectedPersona.icon}</span>
                <span>Agent: <span className="font-medium text-[#37352F]">{preSelectedPersona.name}</span></span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0 ms-4">
            <X className="w-4 h-4" />
          </button>
        </div>

        {preSelectedPersona && (preSelectedPersona.type === 'global' || preSelectedPersona.type === 'community') && (
          <div className="mx-6 mb-2 flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              <span className="font-semibold">Note: </span>
              Starting a session with a community persona will clone it to your Personal Library. This ensures your learning memory remains private and unaffected by external updates.
            </p>
          </div>
        )}

        <div className="px-6 pb-6 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-3">
            Choose a Document
          </p>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#E8E8E6] bg-white hover:border-indigo-300 hover:bg-indigo-50 transition-all duration-150"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <Upload className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-start">
              <p className="text-sm font-medium text-[#37352F]">Upload PDF</p>
              <p className="text-xs text-[#787774]">Start a new session with a fresh document</p>
            </div>
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />

          {userDocs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[#787774] mb-2 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Recent Documents
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {userDocs.slice(0, 8).map(doc => (
                  <DocItem
                    key={doc.id}
                    title={doc.title}
                    isSelected={selectedDocId === doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => onStartSession(effectivePersonaId, null)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#E8E8E6] bg-white hover:border-[#C4C4C4] hover:bg-[#F7F7F5] transition-all duration-150"
          >
            <div className="w-8 h-8 rounded-lg bg-[#F7F7F5] border border-[#E8E8E6] flex items-center justify-center shrink-0">
              <span className="text-base leading-none">💬</span>
            </div>
            <div className="text-start">
              <p className="text-sm font-medium text-[#37352F]">Start Without Document</p>
              <p className="text-xs text-[#787774]">Chat with the agent without a PDF</p>
            </div>
          </button>
        </div>

        {selectedDocId !== null && (
          <div className="px-6 pb-6 pt-4 border-t border-[#E8E8E6] flex items-center justify-between">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6] transition-colors duration-150">
              Cancel
            </button>
            <button
              onClick={() => onStartSession(effectivePersonaId, selectedDocId)}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
            >
              <Play className="w-4 h-4" />
              Start Session
            </button>
          </div>
        )}
      </>
    );
  }

  // ── From-doc mode (default) ────────────────────────────────────────────────
  return wrapModal(
    <>
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-4">
        <div>
          <h2 className="text-base font-bold text-[#37352F]">Start Study Session</h2>
          {documentName && (
            <p className="text-xs text-[#787774] mt-1 flex items-center gap-1.5">
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-xs">{documentName}</span>
            </p>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150 shrink-0 ms-4">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isSameSessionDoc && lastSessionPersona && (
        <div className="mx-6 mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 border border-indigo-200 flex items-center justify-center shrink-0 text-lg leading-none">
                {lastSessionPersona.icon}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-indigo-800 leading-tight flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  Continue where you left off
                </p>
                <p className="text-[10px] text-indigo-600 mt-0.5">
                  Agent: {lastSessionPersona.name}
                </p>
              </div>
            </div>
            <button
              onClick={() => onStartSession(lastSessionPersonaId, openedDocumentId ?? null)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors duration-150 shrink-0"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
          </div>
        </div>
      )}

      {!isSameSessionDoc && activeSession && lastSessionPersona && (
        <div className="mx-6 mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-800 leading-tight">Resume previous session</p>
              <p className="text-[10px] text-amber-600 mt-0.5 truncate">
                Agent: {lastSessionPersona.icon} {lastSessionPersona.name}
              </p>
            </div>
          </div>
          <button
            onClick={() => onStartSession(lastSessionPersonaId, null)}
            className="flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-3 py-1.5 rounded-lg transition-colors duration-150 shrink-0"
          >
            <Play className="w-3 h-3" />
            Resume
          </button>
        </div>
      )}

      {/* Agent selection */}
      <div className="px-6">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C4C4C4] mb-3">
          Choose an Agent
        </p>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
          <MiniCard
            icon="🤖"
            name="No Agent"
            isSelected={selectedPersonaId === null}
            onClick={() => setSelectedPersonaId(null)}
          />
          {personalPersonas.map(p => (
            <MiniCard
              key={p.id}
              icon={p.icon}
              name={p.name}
              isSelected={selectedPersonaId === p.id}
              onClick={() => setSelectedPersonaId(p.id)}
            />
          ))}
        </div>
      </div>

      <div className="px-6 mt-3 mb-4 min-h-[44px]">
        {selectedPersona ? (
          <div className="px-3 py-2 bg-[#F7F7F5] border border-[#E8E8E6] rounded-lg">
            <p className="text-xs text-[#37352F] leading-relaxed">
              <span className="font-semibold">{selectedPersona.name}: </span>
              <span className="text-[#787774]">{selectedPersona.description}</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-[#C4C4C4] italic ps-1">
            No Agent — the model will respond with default behavior, without a persona.
          </p>
        )}
      </div>

      {selectedPersona && (selectedPersona.type === 'global' || selectedPersona.type === 'community') && (
        <div className="mx-6 mb-4 flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-semibold">Note: </span>
            Starting a session with a community persona will clone it to your Personal Library. This ensures your learning memory remains private and unaffected by external updates.
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 pb-6 pt-4 border-t border-[#E8E8E6] flex items-center justify-between">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6] transition-colors duration-150"
        >
          Cancel
        </button>
        <button
          onClick={() => onStartSession(selectedPersonaId, null)}
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
        >
          <Play className="w-4 h-4" />
          Start Session
        </button>
      </div>
    </>
  );
}
