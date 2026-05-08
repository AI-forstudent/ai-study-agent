import { useState, useEffect } from 'react';
import { api } from '../services/api';

/**
 * Hook to manage authentication state and top-level view routing.
 * Handles: login flag, view switching, auth modal visibility, and startup health check.
 */
export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    !!localStorage.getItem('access_token')
  );
  const [view, setView] = useState<'main' | 'lab' | 'gallery' | 'settings' | 'hub' | 'admin'>('main');
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);

  // Fire-and-forget health check on mount; failure is non-fatal.
  useEffect(() => {
    api.checkHealth().catch(() => {});
  }, []);

  function handleLogoutToLanding() {
    setIsAuthenticated(false);
    setAuthModalOpen(false);
  }

  return {
    isAuthenticated, setIsAuthenticated,
    view, setView,
    isAuthModalOpen, setAuthModalOpen,
    handleLogoutToLanding,
  };
}
