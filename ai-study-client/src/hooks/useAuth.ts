import { useState, useEffect } from 'react';
import { api } from '../services/api';

type View = 'main' | 'lab' | 'gallery' | 'settings' | 'hub';
const VALID_VIEWS: readonly View[] = ['main', 'lab', 'gallery', 'settings', 'hub'];
const VIEW_KEY = 'studyagent_view';

function loadPersistedView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw && (VALID_VIEWS as readonly string[]).includes(raw)) return raw as View;
  } catch { /* ignore */ }
  return 'main';
}

/**
 * Hook to manage authentication state and top-level view routing.
 * Handles: login flag, view switching, auth modal visibility, and startup health check.
 *
 * F-037 — `view` is persisted to localStorage so a hard refresh restores
 * the user to the same top-level screen (My Library, Courses, AI
 * Teachers, etc.) instead of throwing them back to 'main'. Pairs with
 * the per-screen persistence in the components themselves (e.g.
 * `MyLibrary`'s `activeFolderId`, `useAppStore.activeLecture`).
 */
export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    !!localStorage.getItem('access_token')
  );
  const [view, _setView] = useState<View>(loadPersistedView);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);

  // Wrapper that writes-through to localStorage on every change.
  function setView(next: View) {
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* quota / private mode */ }
    _setView(next);
  }

  // Fire-and-forget health check on mount; failure is non-fatal.
  useEffect(() => {
    api.checkHealth().catch(() => {});
  }, []);

  function handleLogoutToLanding() {
    setIsAuthenticated(false);
    setAuthModalOpen(false);
    try { localStorage.removeItem(VIEW_KEY); } catch { /* ignore */ }
  }

  return {
    isAuthenticated, setIsAuthenticated,
    view, setView,
    isAuthModalOpen, setAuthModalOpen,
    handleLogoutToLanding,
  };
}
