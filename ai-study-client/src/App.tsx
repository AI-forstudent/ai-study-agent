import { useState, useEffect } from 'react';
import { pdfjs } from 'react-pdf';

import 'katex/dist/katex.min.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import PersonaLab            from './features/personas/components/PersonaLab';
import PersonalHubDashboard from './features/PersonalHub/PersonalHubDashboard';
import CoursesPage          from './features/courses/components/CoursesPage';
import ConfirmModal   from './components/ConfirmModal';
import PreFlightModal from './features/sessions/components/PreFlightModal';
import PublicGallery  from './features/personas/components/PublicGallery';
import MainWorkspace  from './components/layout/MainWorkspace';
import MyLibrary      from './components/layout/MyLibrary';
import LandingPage    from './components/layout/LandingPage';
import AppLayout      from './components/layout/AppLayout';
import Sidebar        from './components/layout/Sidebar';
import Settings       from './components/layout/Settings';
import AuthModal      from './components/ui/AuthModal';
import { showToast }  from './hooks/useToast';
import { api }        from './services/api';
import { ResumeToastContainer } from './features/sessions/components/ResumeToast';
import SessionWrapUpModal       from './features/sessions/components/SessionWrapUpModal';

import { useAuth }      from './hooks/useAuth';
import { useMe }        from './hooks/useMe';
import { useDocuments } from './hooks/useDocuments';
import { useChat }      from './hooks/useChat';
import { useFolders }   from './features/documents/hooks/useFolders';
import { useAppStore }  from './store/useAppStore';

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function App() {
  const {
    isAuthenticated, setIsAuthenticated,
    view, setView,
    isAuthModalOpen, setAuthModalOpen,
    handleLogoutToLanding,
  } = useAuth();

  const [showGallery, setShowGallery] = useState(false);

  // ── Zustand store ───────────────────────────────────────────────────────────
  const personas            = useAppStore(state => state.personas);
  const fetchPersonas       = useAppStore(state => state.fetchPersonas);
  const activeSession       = useAppStore(state => state.activeSession);
  const setActiveSession    = useAppStore(state => state.setActiveSession);
  const clearActiveSession  = useAppStore(state => state.clearActiveSession);
  const saveSessionMemory   = useAppStore(state => state.saveSessionMemory);
  const clonePersona        = useAppStore(state => state.clonePersona);
  const dismissResumePrompt = useAppStore(state => state.dismissResumePrompt);
  const setActiveLecture    = useAppStore(state => state.setActiveLecture);
  const pendingDocumentSwitch    = useAppStore(state => state.pendingDocumentSwitch);
  const setPendingDocumentSwitch = useAppStore(state => state.setPendingDocumentSwitch);

  // ── Hydrate personas whenever auth becomes available ──────────────────────
  // Depending on `isAuthenticated` (not just on mount) ensures a fresh login
  // triggers a re-fetch — otherwise personas can stay empty after AuthModal
  // succeeds because the original mount-effect already ran with no token.
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchPersonas();
  }, [isAuthenticated, fetchPersonas]);

  // ── F-036: lecture accordion → document switch bus ─────────────────────
  // ChatPanel's Lecture tab sets `pendingDocumentSwitch` when the user
  // picks a different summary. We pick it up here so the document load
  // (which lives in the useDocuments hook) actually happens.
  useEffect(() => {
    if (pendingDocumentSwitch == null) return;
    const id = pendingDocumentSwitch;
    setPendingDocumentSwitch(null);
    docs.handleSelectDocument({ id });
    setActiveSession({ documentId: id, personaId: null });
    setActivePersonaId(null);
    setStandaloneMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDocumentSwitch]);

  // ── Pre-flight & persona session state ─────────────────────────────────────
  const [isPreFlightOpen, setPreFlightOpen]               = useState(false);
  const [selectedDocForSession, setSelectedDocForSession] = useState<{ id: number; title: string } | null>(null);
  const [activePersonaId, setActivePersonaId]             = useState<string | null>(null);
  /** Set when "Use for Session" is clicked in PersonaLab — opens PreFlight in from-persona mode. */
  const [preFlightPersonaId, setPreFlightPersonaId]       = useState<string | null | undefined>(undefined);
  /** True when a chat-only (no document) session is active. */
  const [standaloneMode, setStandaloneMode]               = useState(false);
  const [activeCourseId, setActiveCourseId]               = useState<number | null>(null);
  /** Cross-page folder open. Set by the Courses page when the user clicks a
   *  folder card inside a course's Folders tab; MyLibrary picks it up and
   *  drills into the folder. (Course detail lives in the Courses page now,
   *  so the matching `pendingLibraryCourseId` from B-009 is gone — courses
   *  no longer round-trip through My Library.) */
  const [pendingLibraryFolderId, setPendingLibraryFolderId] = useState<number | null>(null);
  const [isWrapUpOpen, setWrapUpOpen]                     = useState(false);

  const docs    = useDocuments(isAuthenticated, handleLogout);
  const folders = useFolders(isAuthenticated);
  const chat    = useChat(docs.documentId, docs.currentPage, activePersonaId, activeCourseId);
  const { me, refresh: refreshMe } = useMe(isAuthenticated);

  // ── Derived state ───────────────────────────────────────────────────────────
  const activePersonaName: string | null = activePersonaId
    ? (personas.find(p => p.id === activePersonaId)?.name ?? null)
    : null;

  const isFromPersonaMode = preFlightPersonaId !== undefined;

  // For the resume toast: look up persona name and document title from persisted session
  const toastPersonaName   = activeSession?.personaId
    ? (personas.find(p => p.id === activeSession.personaId)?.name ?? null)
    : null;
  const toastDocTitle = activeSession?.documentId
    ? (docs.userDocs.find((d: { id: number; title: string }) => d.id === activeSession.documentId)?.title ?? null)
    : null;

  // Current document title (for WorkspaceHeader)
  const currentDocTitle = docs.documentId
    ? (docs.userDocs.find((d: { id: number; title: string }) => d.id === docs.documentId)?.title ?? 'Document')
    : standaloneMode ? 'Chat Session' : 'Document';

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleLogout() {
    docs.reset();
    folders.reset();
    chat.reset();
    setActivePersonaId(null);
    setActiveSession(null);
    setActiveCourseId(null);
    setPreFlightPersonaId(undefined);
    setStandaloneMode(false);
    dismissResumePrompt();
    localStorage.removeItem('access_token');
    handleLogoutToLanding();
  }

  function handleLoginSuccess() {
    setIsAuthenticated(true);
    setAuthModalOpen(false);
  }

  /** Intercepts MyLibrary's onSelectDocument.
   *
   * The user does not want a per-click "pick an agent" modal anymore — they
   * just want the document to open. We auto-pick an AI Teacher in this order:
   *   1. The folder's default `persona_id`, if the doc lives in a folder that has one.
   *   2. The previously-active session's persona (continuity).
   *   3. The first personal AI Teacher the user owns.
   *   4. The first global AI Teacher (Socratic Mentor seed) as a final fallback.
   *
   * The user can swap teachers mid-session via SwitchPersonaModal.
   */
  function handleOpenPreFlight(doc: { id: number }) {
    const fullDoc = docs.userDocs.find((d: { id: number; title: string; folder_id?: number | null }) => d.id === doc.id);

    // Resolve a sensible persona without opening a modal.
    const folder = fullDoc?.folder_id != null
      ? folders.folders.find(f => f.id === fullDoc.folder_id)
      : null;
    const folderDefault = folder?.persona_id ?? null;
    const previousPersona = activeSession?.personaId ?? null;
    const ownPersonal = personas.find(p => p.type === 'personal')?.id ?? null;
    const globalFallback = personas.find(p => p.type === 'global')?.id ?? null;

    const autoPersonaId =
      folderDefault   ??
      previousPersona ??
      ownPersonal     ??
      globalFallback  ??
      null;

    void handleStartSession(autoPersonaId, doc.id);
  }

  /** Called from PersonaLab "Use for Session" / hover "Start Session". */
  function handleStartWithPersona(personaId: string) {
    setPreFlightPersonaId(personaId);
    setSelectedDocForSession(null);
    setPreFlightOpen(true);
  }

  /** Called when PreFlight confirms a session. */
  async function handleStartSession(personaId: string | null, documentId: number | null) {
    const docId = documentId ?? selectedDocForSession?.id ?? null;
    // F-036 — entering a non-lecture session clears any prior lecture
    // context so ChatPanel hides the Lecture tab.
    setActiveLecture(null);
    if (docId) {
      docs.handleSelectDocument({ id: docId });
    }

    // Auto-clone global/community personas so memory stays private.
    // We AWAIT the backend so effectivePersonaId is always a real DB row.
    // If the clone fails, fall back to the original ID (it exists in the DB)
    // rather than using a client-side temp ID that would cause a FK violation.
    let effectivePersonaId = personaId;
    if (personaId) {
      const persona = personas.find(p => p.id === personaId);
      if (persona && (persona.type === 'global' || persona.type === 'community')) {
        const clone = await clonePersona(personaId);
        effectivePersonaId = clone?.id ?? personaId;
      }
    }

    setActivePersonaId(effectivePersonaId);
    setActiveSession({ documentId: docId, personaId: effectivePersonaId });
    setStandaloneMode(docId === null);
    dismissResumePrompt();
    setPreFlightOpen(false);
    setSelectedDocForSession(null);
    setPreFlightPersonaId(undefined);
    setView('main');
  }

  /** Mid-session persona switch — called by SwitchPersonaModal via ChatPanel. */
  function handleSwitchPersona(newId: string | null, keepContext: boolean) {
    console.log('INTENT: switch persona mid-session', { from: activePersonaId, to: newId, keepContext });
    setActivePersonaId(newId);
    setActiveSession({ documentId: activeSession?.documentId ?? null, personaId: newId });
  }

  /** Resumes the active session — called from Sidebar nav or ResumeToast. */
  function handleResumeSession() {
    if (activeSession?.documentId) {
      docs.handleSelectDocument({ id: activeSession.documentId });
    }
    setStandaloneMode(activeSession?.documentId === null);
    setActivePersonaId(activeSession?.personaId ?? null);
    dismissResumePrompt();
    setView('main');
  }

  /** F-036 — open a lecture in MainWorkspace as a session.
   *
   *  Priority for which document opens first:
   *    1. The unified summary's rendered PDF (if generated).
   *    2. The first lecturer-summary PDF.
   *    3. The first student-summary PDF.
   *    4. The first PDF-type notes attachment.
   *    5. Otherwise null — MainWorkspace shows the "no doc" state but
   *       the Lecture tab still surfaces the accordion so the user can
   *       upload / generate from there.
   *
   *  Stores the lecture in the global store so ChatPanel's Lecture tab
   *  can render the accordion without prop drilling. */
  function handleOpenLecture(lecture: any) {
    const pickedId =
      lecture?.unified_summary_document_id
      ?? lecture?.lecturer_summaries?.[0]?.user_document_id
      ?? lecture?.student_summaries?.[0]?.user_document_id
      ?? lecture?.notes?.find((n: any) => n?.doc_type !== 'IMAGE' && n?.doc_type !== 'AUDIO')?.user_document_id
      ?? null;

    setActiveLecture(lecture);
    if (pickedId) {
      docs.handleSelectDocument({ id: pickedId });
    }
    setActivePersonaId(null);
    setActiveSession({ documentId: pickedId, personaId: null });
    setStandaloneMode(pickedId === null);
    setView('main');
  }

  /** Sidebar "+ New Session" — open a fresh standalone chat with a sensible
   *  default AI Teacher and clear any previous document/thread state. */
  function handleStartNewSession() {
    startStandaloneSession(null);
  }

  /** "Chat about this course" — same as a new session but the next chat call
   *  will tag the new thread with this course_id so the syllabus is in scope. */
  function handleStartCourseChat(courseId: number) {
    startStandaloneSession(courseId);
  }

  /** F-020 — paperclip-in-chat handler. Uploads `file`, then either attaches
   *  it to the active thread (chat-in-progress case) or creates a fresh
   *  doc-anchored thread on the fly (New Session before first message),
   *  and switches the workspace UI to PDF + chat split via
   *  `docs.handleSelectDocument`.
   *
   *  Duplicate-file handling: CAS dedup raises a 409 with structured detail
   *  `{ code, existing_user_document_id }`. We treat that as a soft success
   *  — attach the existing doc to the thread instead of bailing. Same
   *  content, same hash, no need to ask the user; we surface a small toast
   *  so the user knows what happened. */
  async function handleAttachFileToActiveSession(file: File): Promise<void> {
    // 1. Try to upload (auto-summarize is off — F-021).
    let attachId: number;
    let wasDuplicate = false;
    try {
      const uploadRes = await api.uploadDocument(file, false);
      attachId = uploadRes.data.id;
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const existingId =
        err?.response?.status === 409 && typeof detail === 'object'
          ? detail?.existing_user_document_id
          : undefined;
      if (typeof existingId === 'number') {
        attachId = existingId;
        wasDuplicate = true;
      } else {
        throw err;   // unrecognised failure — propagate to ChatPanel's catch
      }
    }

    // 2. Refresh the user's docs list. We need the FRESH list (not the
    //    closure-captured one inside the hook) to resolve the brand-new doc
    //    by id below — `handleSelectDocument`'s closure would still hold the
    //    pre-upload userDocs and silently bail on `find()` returning undefined.
    const freshDocs = (await docs.refreshUserDocs()) ?? [];
    const fullDoc = freshDocs.find((d: any) => d.id === attachId);
    if (!fullDoc) {
      console.error('[handleAttachFileToActiveSession] doc not in refreshed list', attachId);
      throw new Error('Uploaded document did not appear in the refreshed list.');
    }

    // 3. Attach to thread or create one. The current activeThread lives in
    //    Zustand; we read it freshly to dodge stale closures.
    const currentThread = useAppStore.getState().activeThread;
    if (currentThread) {
      await api.updateThread(currentThread.id, { document_id: attachId });
    } else {
      // Standalone session before any message — create a doc-anchored
      // thread now so subsequent /threads/.../messages calls have a target.
      const created = await api.createThread({
        document_id: attachId,
        persona_id: activePersonaId,
        course_id: activeCourseId,
      });
      useAppStore.getState().setActiveThread(created.data);
    }

    // 4. Flip the workspace to doc-anchored. We use `selectDocumentInList`
    //    (not `handleSelectDocument`) because it (a) takes the freshly-
    //    resolved doc object so it doesn't rely on a stale closure, and
    //    (b) preserves the active thread we just attached/created — the
    //    default `setActiveThread(null)` would drop the user's conversation
    //    on the floor and bounce them to an empty Threads tree.
    await docs.selectDocumentInList(fullDoc, { preserveActiveThread: true });
    setStandaloneMode(false);

    if (wasDuplicate) {
      showToast(
        'This file is already in your library — opened the existing copy.',
        'info',
      );
    }
  }

  /** Folder click inside a course's Folders tab on the Courses page. Drills
   *  the user across to My Library and opens that folder. Same cross-page
   *  pattern as the (now retired) pendingLibraryCourseId flow, just for
   *  folders. */
  function handleOpenFolderInLibrary(folderId: number) {
    docs.clearDocument();
    chat.reset();
    setStandaloneMode(false);
    setActivePersonaId(null);
    setActiveCourseId(null);
    setPendingLibraryFolderId(folderId);
    setView('main');
  }

  function startStandaloneSession(courseId: number | null) {
    docs.clearDocument();
    chat.reset();
    const defaultPersona =
      personas.find(p => p.type === 'personal')?.id ??
      personas.find(p => p.type === 'global')?.id ??
      null;
    setActivePersonaId(defaultPersona);
    setActiveSession({ documentId: null, personaId: defaultPersona });
    setActiveCourseId(courseId);
    setStandaloneMode(true);
    dismissResumePrompt();
    // No active thread yet — the first message creates the thread server-side
    // and the chat hook attaches course_id at that moment.
    useAppStore.getState().setActiveThread(null);
    setView('main');
  }

  /** Open a past session by id — load its document if present, else go
   *  standalone. The thread payload itself becomes the active thread so the
   *  chat tab opens with full message history. */
  async function handleOpenSession(sessionId: number) {
    try {
      const res = await api.getThread(sessionId);
      const thread = res.data;
      if (!thread) {
        alert('Could not load that session.');
        return;
      }
      setActivePersonaId(thread.persona_id ?? null);

      if (thread.document_id) {
        await docs.handleSelectDocument({ id: thread.document_id });
        setStandaloneMode(false);
      } else {
        docs.clearDocument();
        setStandaloneMode(true);
      }
      setActiveSession({
        documentId: thread.document_id ?? null,
        personaId: thread.persona_id ?? null,
      });
      useAppStore.getState().setActiveThread(thread);
      setView('main');
    } catch (err) {
      console.error('[handleOpenSession]', err);
      alert('Could not load that session.');
    }
  }

  function handleOpenWrapUp() {
    setWrapUpOpen(true);
  }

  function handleWrapUpSave(compressionLevel: number, userInstructions: string) {
    if (activePersonaId) {
      saveSessionMemory(activePersonaId, compressionLevel, userInstructions);
    }
    clearActiveSession();
    setWrapUpOpen(false);
    setActivePersonaId(null);
    setStandaloneMode(false);
    docs.reset();
    chat.reset();
    setView('main');
  }

  // ── Unauthenticated ─────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <>
        {showGallery ? (
          <PublicGallery
            isAuthenticated={false}
            onBack={() => setShowGallery(false)}
            onGetStarted={() => setAuthModalOpen(true)}
          />
        ) : (
          <LandingPage
            onGetStarted={() => setAuthModalOpen(true)}
            onOpenGallery={() => setShowGallery(true)}
          />
        )}
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      </>
    );
  }

  // ── Authenticated — sidebar shell ───────────────────────────────────────────
  const sidebar = (
    <Sidebar
      activeView={view}
      onNavigate={(v) => {
        if (v === 'main' || v === 'settings' || v === 'hub') {
          docs.clearDocument();
          setStandaloneMode(false);
        }
        setView(v);
      }}
      onLogout={handleLogout}
      onNewSession={handleStartNewSession}
    />
  );

  if (view === 'settings') {
    return (
      <AppLayout sidebar={sidebar}>
        <Settings
          treeViewMode={chat.treeViewMode}
          setTreeViewMode={chat.setTreeViewMode}
          me={me}
          onRolesChanged={refreshMe}
        />
        <ResumeToastContainer
          personaName={toastPersonaName}
          documentTitle={toastDocTitle}
          onResume={handleResumeSession}
        />
      </AppLayout>
    );
  }

  if (view === 'lab') {
    return (
      <AppLayout sidebar={sidebar}>
        <PersonaLab
          onBack={() => setView('main')}
          onStartWithPersona={handleStartWithPersona}
        />
        <ResumeToastContainer
          personaName={toastPersonaName}
          documentTitle={toastDocTitle}
          onResume={handleResumeSession}
        />
        {/* PreFlightModal MUST be present here — PersonaLab triggers it from this view */}
        <PreFlightModal
          isOpen={isPreFlightOpen}
          onClose={() => {
            setPreFlightOpen(false);
            setSelectedDocForSession(null);
            setPreFlightPersonaId(undefined);
          }}
          mode={isFromPersonaMode ? 'from-persona' : 'from-doc'}
          documentName={selectedDocForSession?.title}
          openedDocumentId={selectedDocForSession?.id}
          preSelectedPersonaId={preFlightPersonaId}
          userDocs={docs.userDocs}
          onFileInputChange={docs.handleFileChange}
          onStartSession={handleStartSession}
        />
      </AppLayout>
    );
  }

  if (view === 'gallery') {
    return (
      <AppLayout sidebar={sidebar}>
        <CoursesPage
          folders={folders.folders}
          userDocs={docs.userDocs}
          personas={personas}
          onStartCourseChat={handleStartCourseChat}
          onOpenFolderInLibrary={handleOpenFolderInLibrary}
          onCreateFolder={folders.createFolder}
          onOpenLecture={handleOpenLecture}
        />
        <ResumeToastContainer
          personaName={toastPersonaName}
          documentTitle={toastDocTitle}
          onResume={handleResumeSession}
        />
      </AppLayout>
    );
  }

  if (view === 'hub') {
    return (
      <AppLayout sidebar={sidebar}>
        <PersonalHubDashboard />
        <ResumeToastContainer
          personaName={toastPersonaName}
          documentTitle={toastDocTitle}
          onResume={handleResumeSession}
        />
      </AppLayout>
    );
  }

  // ── Main: Library dashboard or active workspace ─────────────────────────────
  const isInWorkspace = !!docs.documentId || standaloneMode;

  return (
    <AppLayout sidebar={sidebar}>
      {!isInWorkspace ? (
        <>
          <MyLibrary
            userDocs={docs.userDocs}
            isUploading={docs.isUploading}
            uploadError={docs.uploadError}
            onUploadFile={docs.handleFileChange}
            onSelectDocument={handleOpenPreFlight}
            onSelectSession={handleOpenSession}
            onStartNewSession={handleStartNewSession}
            onDeleteRequest={docs.setDocToDelete}
            onStarDocument={docs.handleStarDocument}
            onMoveDocument={docs.handleMoveDocument}
            folders={folders.folders}
            onCreateFolder={folders.createFolder}
            onUpdateFolder={folders.updateFolder}
            onDeleteFolder={folders.deleteFolder}
            personas={personas}
            pendingFolderId={pendingLibraryFolderId}
            onPendingFolderConsumed={() => setPendingLibraryFolderId(null)}
          />
          <ResumeToastContainer
            personaName={toastPersonaName}
            documentTitle={toastDocTitle}
            onResume={handleResumeSession}
          />
        </>
      ) : (
        <MainWorkspace
          doc={{
            file:           docs.file,
            documentId:     docs.documentId,
            documentTitle:  currentDocTitle,
            docType:        docs.docType,
            numPages:       docs.numPages,
            setNumPages:    docs.setNumPages,
            currentPage:    docs.currentPage,
            setCurrentPage: docs.setCurrentPage,
          }}
          chat={{
            threads:            chat.threads,
            inputMessage:       chat.inputMessage,
            setInputMessage:    chat.setInputMessage,
            isSending:          chat.isSending,
            isCreatingThread:   chat.isCreatingThread,
            pendingForkMsgId:   chat.pendingForkMsgId,
            treeViewMode:       chat.treeViewMode,
            handleCreateThread: chat.handleCreateThread,
            handleQuickAction:  chat.handleQuickAction,
            handleSmartAction:  chat.handleSmartAction,
            handleForkMessage:  chat.handleForkMessage,
            handleSendMessage:  chat.handleSendMessage,
            activePersonaName,
            activePersonaId,
            onSwitchPersona:    handleSwitchPersona,
            onAttachFile:       handleAttachFileToActiveSession,
          }}
          onSaveMemory={handleOpenWrapUp}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={docs.docToDelete !== null}
        message="Are you sure you want to permanently delete this document? This will also delete all associated conversations."
        isLoading={docs.isDeleting}
        onConfirm={docs.handleDeleteConfirm}
        onCancel={() => docs.setDocToDelete(null)}
      />

      {/* Pre-flight modal */}
      <PreFlightModal
        isOpen={isPreFlightOpen}
        onClose={() => {
          setPreFlightOpen(false);
          setSelectedDocForSession(null);
          setPreFlightPersonaId(undefined);
        }}
        mode={isFromPersonaMode ? 'from-persona' : 'from-doc'}
        documentName={selectedDocForSession?.title}
        openedDocumentId={selectedDocForSession?.id}
        preSelectedPersonaId={preFlightPersonaId}
        userDocs={docs.userDocs}
        onFileInputChange={docs.handleFileChange}
        onStartSession={handleStartSession}
      />

      {/* Session wrap-up modal */}
      <SessionWrapUpModal
        isOpen={isWrapUpOpen}
        onClose={() => setWrapUpOpen(false)}
        onSave={handleWrapUpSave}
        personaName={activePersonaName}
      />
    </AppLayout>
  );
}

export default App;
