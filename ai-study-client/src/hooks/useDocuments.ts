import { useState, useEffect, useMemo, type ChangeEvent } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { showToast } from './useToast';

/**
 * Hook to manage document lifecycle.
 * Handles: fetching the user's library, uploading, selecting (blob load), and deletion.
 *
 * When documentId changes, useChat's own effect clears and re-fetches threads —
 * no explicit setThreads call is needed here.
 */
export function useDocuments(isAuthenticated: boolean, onAuthError: () => void) {
  const { setActiveThread } = useAppStore();

  const [file, setFile]                     = useState<any>(null);
  const [documentId, setDocumentId]         = useState<number | null>(null);
  const [numPages, setNumPages]             = useState<number>(0);
  const [currentPage, setCurrentPage]       = useState<number>(1);
  const [userDocs, setUserDocs]             = useState<any[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [isUploading, setIsUploading]       = useState(false);
  const [uploadError, setUploadError]       = useState<string | null>(null);
  const [docToDelete, setDocToDelete]       = useState<{ id: number; title: string } | null>(null);
  const [isDeleting, setIsDeleting]         = useState(false);

  // Sync isPublic from userDocs when the active document changes.
  useEffect(() => {
    const doc = userDocs.find(d => d.id === documentId);
    setIsPublic(doc?.is_public ?? false);
  }, [documentId, userDocs]);

  // Fetch document list whenever the user authenticates.
  useEffect(() => {
    if (!isAuthenticated) return;
    api.getUserDocuments()
      .then(res => setUserDocs(res.data))
      .catch(err => {
        console.error('Failed to fetch documents:', err);
        if (err.response?.status === 401) onAuthError();
      });
  }, [isAuthenticated]);

  /** Refresh the user's document list — call after an upload from outside
   *  this hook (e.g. the F-020 attach-from-chat flow), so the new doc
   *  appears in the Files lane and `handleSelectDocument` can resolve
   *  it by id. */
  const refreshUserDocs = async () => {
    try {
      const res = await api.getUserDocuments();
      setUserDocs(res.data);
      return res.data as any[];
    } catch (err) {
      console.error('[refreshUserDocs] failed:', err);
      return null;
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const IS_DEV_MODE = false;
    if (IS_DEV_MODE) {
      setFile(selectedFile);
      setDocumentId(999);
      setActiveThread(null);
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      // Auto-summarize toggle removed (F-021) — never request a full-doc
      // summary at upload time anymore.
      const response = await api.uploadDocument(selectedFile, false);
      const newDoc = response.data;

      // Refresh the user's docs first so handleSelectDocument can resolve
      // the new doc by id.
      const docsRes = await api.getUserDocuments();
      setUserDocs(docsRes.data);

      // Open the new doc in the workspace via the same blob-fetch path that
      // clicking a doc card uses. The previous code set `setFile(File)`
      // directly, which react-pdf could fail to render — leaving the user
      // staring at an empty viewer and bouncing back to the library on the
      // next navigation.
      setActiveThread(null);
      setDocumentId(newDoc.id);
      try {
        const encodedPath = newDoc.file_path.split('/').map(encodeURIComponent).join('/');
        const blobRes = await api.getFile(encodedPath);
        setFile(URL.createObjectURL(blobRes.data));
      } catch (blobErr) {
        // Fallback to the raw File object if the blob fetch fails — better
        // than nothing.
        console.error('[handleFileChange] blob fetch failed, using File object', blobErr);
        setFile(selectedFile);
      }
    } catch (err: any) {
      if (err?.response?.status === 409) {
        // Duplicate hash — same file already in the user's library.
        // Open the existing copy in the workspace so the user lands on
        // the doc they just tried to upload, instead of staring at a
        // banner on the My Library root.
        const detail = err?.response?.data?.detail;
        const existingId =
          typeof detail === 'object' ? detail?.existing_user_document_id : undefined;
        if (typeof existingId === 'number') {
          try {
            const docsRes = await api.getUserDocuments();
            setUserDocs(docsRes.data);
            const existing = docsRes.data.find((d: any) => d.id === existingId);
            if (existing) {
              setActiveThread(null);
              setDocumentId(existingId);
              try {
                const encodedPath = existing.file_path.split('/').map(encodeURIComponent).join('/');
                const blobRes = await api.getFile(encodedPath);
                setFile(URL.createObjectURL(blobRes.data));
              } catch {
                setFile(selectedFile);
              }
              showToast(
                'This file is already in your library — opened the existing copy.',
                'info',
              );
              return;
            }
          } catch (lookupErr) {
            console.error('[handleFileChange] existing-doc lookup failed', lookupErr);
          }
        }
        // Fallback if we couldn't resolve the existing doc — show a toast
        // instead of the legacy DOCUMENT_EXISTS banner.
        showToast('This file is already in your library.', 'info');
      } else {
        showToast('Upload failed. Please check the file and try again.', 'error');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectDocument = async (doc: { id: number }) => {
    const full = userDocs.find(d => d.id === doc.id);
    if (!full) return;
    setDocumentId(doc.id);  // triggers useChat to clear + re-fetch threads
    setActiveThread(null);

    // Bump `last_opened_at` so the My Library Files lane re-sorts. Fire-and-
    // forget — failure to record recency must not block opening the doc.
    // Optimistically update local state too so the lane reorders without
    // needing a round-trip to GET /documents/.
    const nowIso = new Date().toISOString();
    setUserDocs(prev => prev.map(d => d.id === doc.id ? { ...d, last_opened_at: nowIso } : d));
    api.touchDocument(doc.id).catch(() => { /* noop */ });

    try {
      const encodedPath = full.file_path.split('/').map(encodeURIComponent).join('/');
      const response    = await api.getFile(encodedPath);
      const blobUrl     = URL.createObjectURL(response.data);
      setFile(blobUrl);
    } catch (error) {
      console.error('Failed to load document via Blob:', error);
      alert('Could not load the document — it may be corrupted or removed from the server.');
    }
  };

  /** Open a document in the workspace using a full doc object the caller has
   *  already resolved against a fresh list (e.g. the array returned by
   *  `refreshUserDocs()`).
   *
   *  Why this exists: `handleSelectDocument` looks the doc up inside its
   *  closure-captured `userDocs`. For an attach-from-chat flow that just
   *  uploaded a brand-new doc, that closure is stale — `userDocs.find()`
   *  returns undefined and the function silently bails, leaving the user
   *  bounced to My Library. Pass the freshly-fetched doc object here to
   *  bypass the closure.
   *
   *  `preserveActiveThread` keeps the current Zustand `activeThread` intact
   *  (used by the F-020 paperclip flow, where the user is mid-conversation
   *  and we want their thread to keep rendering after the doc attaches).
   *  Default false matches `handleSelectDocument`'s clear-on-select UX. */
  const selectDocumentInList = async (
    full: any,
    options?: { preserveActiveThread?: boolean },
  ): Promise<boolean> => {
    if (!full || typeof full.id !== 'number' || !full.file_path) return false;
    setDocumentId(full.id);
    if (!options?.preserveActiveThread) setActiveThread(null);

    const nowIso = new Date().toISOString();
    setUserDocs(prev => prev.map(d => d.id === full.id ? { ...d, last_opened_at: nowIso } : d));
    api.touchDocument(full.id).catch(() => { /* noop */ });

    try {
      const encodedPath = full.file_path.split('/').map(encodeURIComponent).join('/');
      const response    = await api.getFile(encodedPath);
      setFile(URL.createObjectURL(response.data));
      return true;
    } catch (error) {
      console.error('[selectDocumentInList] blob fetch failed:', error);
      return false;
    }
  };

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteDocument(docToDelete.id);
      setUserDocs(prev => prev.filter(d => d.id !== docToDelete.id));
      if (documentId === docToDelete.id) {
        setDocumentId(null);    // triggers useChat to clear threads
        setFile(null);
        setActiveThread(null);
        setCurrentPage(1);
      }
      setDocToDelete(null);
    } catch {
      alert('Failed to delete the document. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleVisibility = async () => {
    if (!documentId) return;
    const next = !isPublic;
    setIsPublic(next); // optimistic update
    try {
      await api.toggleVisibility(documentId, next);
      setUserDocs(prev => prev.map(d => d.id === documentId ? { ...d, is_public: next } : d));
    } catch {
      setIsPublic(!next); // rollback on error
    }
  };

  /** Toggle visibility for any doc by id (used by MyLibrary cards). */
  const toggleVisibilityById = async (id: number) => {
    const doc = userDocs.find(d => d.id === id);
    if (!doc) return;
    const next = !doc.is_public;
    setUserDocs(prev => prev.map(d => d.id === id ? { ...d, is_public: next } : d));
    if (id === documentId) setIsPublic(next);
    try {
      await api.toggleVisibility(id, next);
    } catch {
      setUserDocs(prev => prev.map(d => d.id === id ? { ...d, is_public: !next } : d));
      if (id === documentId) setIsPublic(!next);
    }
  };

  // doc_type of the currently active document ('GENERAL' | 'SOURCE_CODE')
  const docType: string = useMemo(() => {
    const doc = userDocs.find(d => d.id === documentId);
    return (doc as any)?.doc_type ?? 'GENERAL';
  }, [documentId, userDocs]);

  /** Clear the active document without wiping the library list. */
  const clearDocument = () => {
    setFile(null);
    setDocumentId(null);
    setCurrentPage(1);
    setActiveThread(null);
  };

  const handleMoveDocument = async (docId: number, folderId: number | null) => {
    setUserDocs(prev => prev.map(d => d.id === docId ? { ...d, folder_id: folderId } : d));
    try {
      await api.moveDocument(docId, folderId);
    } catch (err) {
      console.error('[handleMoveDocument] Failed:', err);
      const docsRes = await api.getUserDocuments();
      setUserDocs(docsRes.data);
    }
  };

  const handleStarDocument = async (docId: number, isStarred: boolean) => {
    setUserDocs(prev => prev.map(d => d.id === docId ? { ...d, is_starred: isStarred } : d));
    try {
      await api.starDocument(docId, isStarred);
    } catch {
      setUserDocs(prev => prev.map(d => d.id === docId ? { ...d, is_starred: !isStarred } : d));
    }
  };

  /** Called by App on logout to clear all document state. */
  const reset = () => {
    setFile(null);
    setDocumentId(null);
    setUserDocs([]);
    setCurrentPage(1);
    setActiveThread(null);
  };

  return {
    file, setFile,
    documentId,
    numPages, setNumPages,
    currentPage, setCurrentPage,
    userDocs,
    isUploading, uploadError,
    docToDelete, setDocToDelete,
    isDeleting,
    handleFileChange,
    handleSelectDocument,
    selectDocumentInList,
    refreshUserDocs,
    handleDeleteConfirm,
    handleToggleVisibility,
    toggleVisibilityById,
    handleMoveDocument,
    handleStarDocument,
    clearDocument,
    docType,
    isPublic,
    reset,
  };
}
