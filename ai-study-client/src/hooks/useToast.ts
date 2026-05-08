import { useEffect, useState } from 'react';

/**
 * Tiny global toast system. Module-level state — no context, no Zustand
 * slice, no extra deps. Components call `showToast(message, kind?)` from
 * anywhere; the `<ToastContainer />` mounted in App.tsx subscribes via
 * `useToasts()` and renders the queue.
 *
 * Auto-dismiss after `DURATION_MS` (default 4 s). Each toast has a unique
 * id so the container can transition them in/out cleanly.
 */

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id:      number;
  message: string;
  kind:    ToastKind;
}

const DURATION_MS = 4000;

let _toasts: Toast[] = [];
let _listeners: Array<(t: Toast[]) => void> = [];
let _nextId = 1;

function _emit() {
  for (const l of _listeners) l(_toasts);
}

export function showToast(message: string, kind: ToastKind = 'info'): void {
  const t: Toast = { id: _nextId++, message, kind };
  _toasts = [..._toasts, t];
  _emit();
  window.setTimeout(() => {
    _toasts = _toasts.filter(x => x.id !== t.id);
    _emit();
  }, DURATION_MS);
}

export function dismissToast(id: number): void {
  _toasts = _toasts.filter(x => x.id !== id);
  _emit();
}

export function useToasts(): Toast[] {
  const [snapshot, setSnapshot] = useState<Toast[]>(_toasts);
  useEffect(() => {
    _listeners.push(setSnapshot);
    return () => { _listeners = _listeners.filter(l => l !== setSnapshot); };
  }, []);
  return snapshot;
}
