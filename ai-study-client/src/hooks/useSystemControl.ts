// src/hooks/useSystemControl.ts
import { useEffect } from 'react';
import { api } from '../services/api';

export const useSystemControl = () => {
  const handleShutdown = async () => {
    document.body.innerHTML = `
      <div style='display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;background:#111;color:#666;font-family:sans-serif;text-align:center'>
        <h1 style='font-size:24px;margin-bottom:10px'>המערכת כבתה</h1>
        <p>ניתן לסגור את הטאב</p>
      </div>
    `;
    try {
      api.shutdown().catch(() => {});
      window.close();
    } catch (e) {}
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'q' || e.key === 'Q' || e.key === '/')) {
        e.preventDefault();
        handleShutdown();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { handleShutdown };
};