import { create } from 'zustand';
import { api } from '../services/api';
import type { Thread } from '../types';
import type { Persona } from '../types/persona';

// All persona traffic now goes through `api` (Axios with the auth interceptor).
// Raw fetch() calls do not attach the Bearer token and would 401 against the
// per-user-scoped backend.

// ── localStorage persistence helpers ──────────────────────────────────────

const SESSION_KEY = 'studyagent_active_session';

function loadSavedSession(): { documentId: number | null; personaId: string | null } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: { documentId: number | null; personaId: string | null } | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

// ── State shape ────────────────────────────────────────────────────────────

const _savedSession = loadSavedSession();

interface AppState {
  textSelection: { text: string; x: number; y: number; width: number; height: number } | null;
  activeThread: Thread | null;
  setTextSelection: (selection: { text: string; x: number; y: number; width: number; height: number } | null) => void;
  setActiveThread: (thread: Thread | null) => void;
  clearSelection: () => void;

  // ── Personas ────────────────────────────────────────────────────────────────
  personas: Persona[];
  /**
   * Fetch all personas from the backend and replace the store.
   * Called once on app mount.
   */
  fetchPersonas: () => Promise<void>;
  /**
   * Clones a persona on the backend and waits for the real server-assigned ID
   * before returning. This guarantees the returned Persona's `id` exists in the
   * DB — safe to store in activeSession and send to /api/v1/chat.
   *
   * Returns null if the backend clone fails; callers should fall back to the
   * original persona ID which is always present in the DB.
   */
  clonePersona: (originalId: string) => Promise<Persona | null>;
  /**
   * Creates a new personal persona in the DB (used for deferred clone saves).
   * Returns the server-persisted Persona, or null on failure.
   */
  createPersona: (persona: Persona) => Promise<Persona | null>;
  /**
   * Deletes a personal persona from the DB and removes it from the local store.
   */
  deletePersona: (personaId: string) => Promise<void>;
  /**
   * Updates an existing personal persona in the DB and syncs the local store.
   */
  updatePersona: (id: string, updates: Partial<Persona>) => Promise<Persona | null>;
  /**
   * Appends a structured memory entry to the persona's systemPrompt.
   * compressionLevel: 1 = Deep, 2 = Thematic, 3 = Minimal
   */
  saveSessionMemory: (personaId: string, compressionLevel: number, userInstructions: string) => void;

  // ── Active session ──────────────────────────────────────────────────────────
  activeSession: { documentId: number | null; personaId: string | null } | null;
  setActiveSession: (session: { documentId: number | null; personaId: string | null } | null) => void;
  /** Clears activeSession from both store and localStorage. */
  clearActiveSession: () => void;

  // ── Model tier ──────────────────────────────────────────────────────────────
  /** Controls the intelligence/cost tradeoff shown in the workspace toolbar. */
  selectedModelTier: 'flash-lite' | 'flash' | 'pro';
  setSelectedModelTier: (tier: 'flash-lite' | 'flash' | 'pro') => void;

  // ── AI Provider ─────────────────────────────────────────────────────────────
  /** Which LLM provider to use: openai (ChatGPT), anthropic (Claude), gemini. */
  selectedAIProvider: 'openai' | 'anthropic' | 'gemini';
  setSelectedAIProvider: (provider: 'openai' | 'anthropic' | 'gemini') => void;

  // ── Resume prompt (shown once per app load if a session was persisted) ──────
  showResumePrompt: boolean;
  dismissResumePrompt: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  textSelection: null,
  activeThread:  null,

  setTextSelection: (selection) => set({ textSelection: selection }),
  setActiveThread:  (thread)    => set({ activeThread: thread }),
  clearSelection:   ()          => set({ textSelection: null }),

  // ── Personas ────────────────────────────────────────────────────────────────
  personas: [],   // populated by fetchPersonas on app mount

  fetchPersonas: async () => {
    try {
      const res = await api.getPersonas();
      const data: Persona[] = res.data;
      set({ personas: data });

      // ── Stale-session guard ────────────────────────────────────────────────
      // If localStorage holds a personaId that no longer exists in the DB
      // (e.g. a leftover optimistic temp-ID), clear it so chat requests don't
      // trigger a FK violation. The documentId is preserved so the doc can
      // still be resumed even without a persona.
      const { activeSession } = get();
      if (activeSession?.personaId) {
        const isKnown = data.some(p => p.id === activeSession.personaId);
        if (!isKnown) {
          console.warn(
            `[fetchPersonas] Stale persona ID "${activeSession.personaId}" is not in the DB. ` +
            'Clearing it from the active session to prevent FK violations.',
          );
          const cleaned = { ...activeSession, personaId: null };
          saveSession(cleaned);
          set({ activeSession: cleaned });
        }
      }
    } catch (err) {
      console.error(
        '[fetchPersonas] Failed to load personas. ' +
        'Make sure the API (port 8001) is running and the user is authenticated.',
        err,
      );
    }
  },

  clonePersona: async (originalId) => {
    // NOTE: we intentionally skip the local-store existence check so a
    // page-reload race (store not yet populated) never silently falls back
    // to the shared global ID and attaches session memory to the wrong persona.
    try {
      const res = await api.clonePersona(originalId);
      const serverClone: Persona = res.data;
      // Replace any existing entry with the same ID (avoids phantoms from rapid clones)
      set(state => ({
        personas: [...state.personas.filter(p => p.id !== serverClone.id), serverClone],
      }));
      return serverClone;
    } catch (err) {
      console.error('[clonePersona] Backend clone failed:', err);
      return null;
    }
  },

  createPersona: async (persona) => {
    try {
      const res = await api.createPersona({
        id: persona.id,
        display_name: persona.name,
        description: persona.description ?? '',
        persona_type: 'personal',
        system_prompt: persona.systemPrompt,
        tags: persona.tags,
        icon: persona.icon,
        original_persona_id: persona.originalPersonaId ?? null,
      });
      const saved: Persona = res.data;
      set(state => ({
        personas: [...state.personas.filter(p => p.id !== persona.id), saved],
        activeSession: state.activeSession?.personaId === persona.id
          ? { ...state.activeSession, personaId: saved.id }
          : state.activeSession,
      }));
      return saved;
    } catch (err) {
      console.error('[createPersona] Failed to create persona:', err);
      return null;
    }
  },

  updatePersona: async (id, updates) => {
    try {
      const res = await api.updatePersona(id, {
        display_name:  updates.name,
        description:   updates.description,
        system_prompt: updates.systemPrompt,
        tags:          updates.tags,
        icon:          updates.icon,
      });
      const updated: Persona = res.data;
      set(state => ({
        personas: state.personas.map(p => p.id === id ? updated : p),
      }));
      return updated;
    } catch (err) {
      console.error('[updatePersona] Failed to update persona:', err);
      return null;
    }
  },

  deletePersona: async (personaId) => {
    try {
      await api.deletePersona(personaId);
      set(state => ({ personas: state.personas.filter(p => p.id !== personaId) }));
    } catch (err: unknown) {
      // 404 means the persona doesn't exist in the DB (phantom ID) — treat as
      // success and still remove it from the local store to clean up the stale entry.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        set(state => ({ personas: state.personas.filter(p => p.id !== personaId) }));
        return;
      }
      console.error('[deletePersona] Failed to delete persona', err);
    }
  },

  saveSessionMemory: (personaId, compressionLevel, userInstructions) => {
    const levelLabel = compressionLevel === 1 ? 'Deep' : compressionLevel === 3 ? 'Minimal' : 'Thematic';
    const memoryBlock = [
      `--- SESSION MEMORY (Level ${compressionLevel}: ${levelLabel}) ---`,
      userInstructions || '(no additional instructions)',
    ].join('\n');
    const { personas } = get();
    set({
      personas: personas.map(p =>
        p.id === personaId
          ? {
              ...p,
              systemPrompt: `${p.systemPrompt}\n\n${memoryBlock}`,
              wordCount:    p.wordCount + memoryBlock.split(/\s+/).filter(Boolean).length,
              updatedAt:    new Date().toISOString(),
            }
          : p
      ),
    });
  },

  // ── Active session ──────────────────────────────────────────────────────────
  activeSession: _savedSession,

  setActiveSession: (session) => {
    saveSession(session);
    set({ activeSession: session });
  },

  clearActiveSession: () => {
    saveSession(null);
    set({ activeSession: null });
  },

  // ── Model tier ──────────────────────────────────────────────────────────────
  selectedModelTier:    'flash',
  setSelectedModelTier: (tier) => set({ selectedModelTier: tier }),

  // ── AI Provider ─────────────────────────────────────────────────────────────
  selectedAIProvider:    'openai',
  setSelectedAIProvider: (provider) => set({ selectedAIProvider: provider }),

  // ── Resume prompt ───────────────────────────────────────────────────────────
  showResumePrompt:    _savedSession !== null,
  dismissResumePrompt: () => set({ showResumePrompt: false }),
}));
