import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../services/api';

export interface Folder {
  id: number;
  user_id: number;
  name: string;
  color: string | null;
  is_starred: boolean;
  persona_id: string | null;
  /** Optional parent course; null = top-level folder. */
  course_id: number | null;
  created_at: string;
}

export function useFolders(isAuthenticated: boolean) {
  const [folders, setFolders]               = useState<Folder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [isLoading, setIsLoading]           = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setFolders([]);
      setActiveFolderId(null);
      return;
    }
    setIsLoading(true);
    api.getFolders()
      .then(res => setFolders(res.data))
      .catch(err => console.error('[useFolders] fetch failed:', err))
      .finally(() => setIsLoading(false));
  }, [isAuthenticated]);

  const createFolder = useCallback(async (
    payload: { name: string; color?: string | null; is_starred?: boolean; persona_id?: string | null },
  ): Promise<Folder> => {
    const res = await api.createFolder(payload);
    const folder = res.data as Folder;
    setFolders(prev => [...prev, folder]);
    return folder;
  }, []);

  const updateFolder = useCallback(async (
    id: number,
    payload: { name?: string; color?: string | null; is_starred?: boolean; persona_id?: string | null },
  ): Promise<Folder> => {
    const res = await api.updateFolder(id, payload);
    const updated = res.data as Folder;
    setFolders(prev => prev.map(f => f.id === id ? updated : f));
    return updated;
  }, []);

  const deleteFolder = useCallback(async (id: number): Promise<void> => {
    await api.deleteFolder(id);
    setFolders(prev => prev.filter(f => f.id !== id));
    setActiveFolderId(prev => prev === id ? null : prev);
  }, []);

  const reset = useCallback(() => {
    setFolders([]);
    setActiveFolderId(null);
  }, []);

  return {
    folders,
    isLoading,
    activeFolderId,
    setActiveFolderId,
    createFolder,
    updateFolder,
    deleteFolder,
    reset,
  };
}
