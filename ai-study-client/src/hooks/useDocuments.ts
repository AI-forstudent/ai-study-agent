import { useState, useEffect, useMemo, type ChangeEvent } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';

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
  const [enableGlobalSummary, setEnableGlobalSummary] = useState(false);
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
      const response = await api.uploadDocument(selectedFile, enableGlobalSummary);
      setDocumentId(response.data.id);   // triggers useChat to clear + re-fetch threads
      setFile(selectedFile);
      setActiveThread(null);
      const docsRes = await api.getUserDocuments();
      setUserDocs(docsRes.data);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setUploadError('DOCUMENT_EXISTS');
      } else {
        setUploadError('UPLOAD_FAILED');
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
      alert('לא הצלחנו לטעון את המסמך. ייתכן שהוא פגום או נמחק מהשרת.');
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
      alert('שגיאה במחיקת המסמך. אנא נסה שוב.');
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
    enableGlobalSummary, setEnableGlobalSummary,
    isUploading, uploadError,
    docToDelete, setDocToDelete,
    isDeleting,
    handleFileChange,
    handleSelectDocument,
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
