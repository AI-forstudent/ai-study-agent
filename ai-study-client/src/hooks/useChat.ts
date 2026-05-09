import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import type { Thread, Message } from '../types';

// Grand Vision AI engine — standalone chat (no document).
// Trailing slash matters: chat.router is `@post("/")` mounted at `/api/v1/chat`,
// so the canonical path is `/api/v1/chat/`. Hitting it without the slash relies
// on FastAPI's 307 redirect, which is fragile behind nginx and currently
// produces a hard 404 in dev — see B-010.
const AI_API_BASE = import.meta.env.VITE_AI_API_URL || 'http://localhost:8001';
const STANDALONE_CHAT_API = `${AI_API_BASE}/api/v1/chat/`;

/**
 * Hook to manage the conversation tree and AI interactions.
 * Handles: Thread creation, message forking, and prompt actions.
 *
 * Automatically clears and re-fetches threads whenever documentId changes,
 * making it the single owner of thread lifecycle tied to a document.
 */
export function useChat(
  documentId: number | null,
  currentPage: number,
  activePersonaId: string | null = null,
  activeCourseId: number | null = null,
) {
  const { textSelection, setTextSelection, activeThread, setActiveThread } = useAppStore();

  const [threads, setThreads]               = useState<Thread[]>([]);
  const [inputMessage, setInputMessage]     = useState('');
  const [isSending, setIsSending]           = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [pendingForkMsgId, setPendingForkMsgId] = useState<number | null>(null);
  const [treeViewMode, setTreeViewMode]     = useState<'miller' | 'breadcrumbs' | 'graph'>('miller');

  // Clear then re-fetch threads whenever the active document changes.
  useEffect(() => {
    setThreads([]);
    if (documentId) {
      api.getThreads(documentId).then(res => setThreads(res.data));
    }
  }, [documentId]);

  // ── Thread creation ────────────────────────────────────────────────────
  const handleCreateThread = async (prompt?: string) => {
    if (!documentId || !textSelection) return;
    setIsCreatingThread(true);
    try {
      const payload = {
        document_id:   documentId,
        selected_text: textSelection.text,
        page_number:   currentPage,
        coordinates: {
          x:      textSelection.x,
          y:      textSelection.y,
          width:  (textSelection as any).width,
          height: (textSelection as any).height,
        },
        initial_message: prompt,
      };

      const response  = await api.createThread(payload);
      const newThread = response.data as Thread;
      if (!newThread.messages) newThread.messages = [];

      setActiveThread(newThread);
      setThreads(prev => [...prev, newThread]);
      setTextSelection(null);
      window.getSelection()?.removeAllRanges();

      // Auto-send the initial prompt with an optimistic message.
      if (prompt) {
        setIsSending(true);
        const optimisticMsg: Message = { id: Date.now(), role: 'user', content: prompt };
        const optimisticThread       = { ...newThread, messages: [optimisticMsg] };
        setActiveThread(optimisticThread);
        setThreads(prev => prev.map(t => t.id === newThread.id ? optimisticThread : t));
        try {
          await api.sendMessage(newThread.id, prompt);
          const fresh = await api.getThread(newThread.id);
          setActiveThread(fresh.data);
          setThreads(prev => prev.map(t => t.id === newThread.id ? fresh.data : t));
        } catch {
          alert('Failed to send the prompt to the model.');
        } finally {
          setIsSending(false);
        }
      }
    } catch {
      alert('Failed to create the conversation.');
    } finally {
      setIsCreatingThread(false);
    }
  };

  // ── Quick-action shortcuts (toolbar buttons on the PDF) ────────────────
  const handleQuickAction = (action: 'translate' | 'explain' | 'quiz' | 'chat') => {
    if (action === 'chat') {
      setActiveThread(null);
      handleCreateThread();
      return;
    }
    const prompts: Record<string, string> = {
      translate: 'תרגם את הטקסט המסומן לעברית בצורה מדויקת וזורמת.',
      explain:   'הסבר את הטקסט המסומן במילים פשוטות (כמו לסטודנט מתחיל).',
      quiz:      'צור שאלת הבנה אחת (אמריקאית) על הטקסט המסומן כדי לבחון אותי.',
    };
    setActiveThread(null);
    handleCreateThread(prompts[action]);
  };

  // ── Smart-action shortcuts (deeper cognitive prompts) ──────────────────
  const handleSmartAction = (action: string) => {
    const prompts: Record<string, string> = {
      hint:          'תן לי רמז קטן שיעזור לי להבין את הטקסט המסומן, בלי לגלות את הפתרון המלא.',
      'step-by-step':'הסבר לי את הפתרון או הרעיון שבטקסט המסומן שלב אחר שלב.',
      define:        'מה ההגדרה המדויקת של המושג המסומן בטקסט?',
      example:       'תן לי דוגמה פרקטית מחיי היומיום שתעזור לי להבין את הטקסט המסומן.',
      summarize:     'סכם את הפסקה המסומנת במשפט אחד או שניים קצרים.',
    };
    setActiveThread(null);
    handleCreateThread(prompts[action]);
  };

  // ── Fork toggle ────────────────────────────────────────────────────────
  const handleForkMessage = (messageId: number) => {
    setPendingForkMsgId(prev => (prev === messageId ? null : messageId));
  };

  // ── Message sending (with optional fork) ──────────────────────────────
  const sendMessageToActiveThread = async (messageContent: string) => {
    if (!messageContent.trim() || !activeThread) return;
    setIsSending(true);
    const isFirstMessage = pendingForkMsgId !== null || !activeThread.messages?.length;

    try {
      let targetThread = activeThread;

      // If a fork is pending, materialise it first.
      if (pendingForkMsgId) {
        const forkResponse = await api.forkThread(activeThread.id, pendingForkMsgId);
        targetThread = forkResponse.data;
        setThreads(prev => [...prev, targetThread]);
        setPendingForkMsgId(null);
      }

      // Optimistic update so the user sees their message instantly.
      const optimisticMsg: Message  = { id: Date.now(), role: 'user', content: messageContent };
      const optimisticThread        = { ...targetThread, messages: [...(targetThread.messages || []), optimisticMsg] };
      setActiveThread(optimisticThread);

      const response = await api.sendMessage(targetThread.id, messageContent);

      try {
        const freshRes    = await api.getThread(targetThread.id);
        const finalThread = freshRes.data;
        setActiveThread(finalThread);
        setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));

        // Background re-fetch after metadata generation (title/emoji) completes.
        if (isFirstMessage) {
          setTimeout(async () => {
            try {
              const lateRes         = await api.getThread(targetThread.id);
              const updatedThread   = lateRes.data;
              setThreads(prev => prev.map(t => t.id === updatedThread.id ? updatedThread : t));
              const currentActive   = useAppStore.getState().activeThread;
              if (currentActive?.id === updatedThread.id) setActiveThread(updatedThread);
            } catch (err) {
              console.error('Failed to fetch late metadata', err);
            }
          }, 4500);
        }
      } catch {
        // Fallback: stitch the response into the optimistic thread manually.
        const finalThread = { ...optimisticThread, messages: [...optimisticThread.messages, response.data] };
        setActiveThread(finalThread);
        setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t));
      }
    } catch {
      alert('Failed to send the message.');
    } finally {
      setIsSending(false);
    }
  };

  // ── Standalone chat (no document) via the Grand Vision API ───────────────
  const sendStandaloneMessage = async (messageContent: string) => {
    if (!messageContent.trim()) return;
    setIsSending(true);

    // activePersonaId comes from the hook prop — it is the real DB-verified ID
    // set by App.tsx *after* awaiting the backend clone response, so it is
    // always safe to send to /api/v1/chat without causing a FK violation.
    const personaId = activePersonaId;
    const { selectedModelTier, selectedAIProvider } = useAppStore.getState();

    // Grab the current active thread id (null = first message, create a new thread)
    const currentThread = useAppStore.getState().activeThread;
    const threadId      = currentThread?.id ?? null;

    // Optimistic: show user message immediately
    const optimisticMsg: Message = { id: Date.now(), role: 'user', content: messageContent };
    if (currentThread) {
      const opt = { ...currentThread, messages: [...(currentThread.messages || []), optimisticMsg] };
      useAppStore.getState().setActiveThread(opt);
      setThreads(prev => prev.map(t => t.id === currentThread.id ? opt : t));
    }

    try {
      const res = await fetch(STANDALONE_CHAT_API, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          // The standalone chat endpoint requires auth — the regular axios
          // interceptor isn't in the fetch path so attach the token manually.
          ...(localStorage.getItem('access_token')
            ? { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
            : {}),
        },
        body: JSON.stringify({
          message:     messageContent,
          thread_id:   threadId,
          persona_id:  personaId,
          model_tier:  selectedModelTier,
          ai_provider: selectedAIProvider,
          // Course scoping: only meaningful for the FIRST message of a new
          // thread; thereafter the thread's stored course_id wins server-side.
          course_id:   threadId == null ? activeCourseId : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Chat API error ${res.status}`);
      }

      const data: { thread_id: number; reply: { id: number; role: string; content: string } } =
        await res.json();

      const assistantMsg: Message = {
        id:      data.reply.id,
        role:    'assistant',
        content: data.reply.content,
      };

      if (currentThread && currentThread.id === data.thread_id) {
        // Continuing an existing thread — replace optimistic user msg with real data
        const updated: Thread = {
          ...currentThread,
          messages: [
            ...(currentThread.messages?.filter(m => m.id !== optimisticMsg.id) ?? []),
            optimisticMsg,
            assistantMsg,
          ],
        };
        useAppStore.getState().setActiveThread(updated);
        setThreads(prev => prev.map(t => t.id === data.thread_id ? updated : t));
      } else {
        // Brand-new thread returned by the server
        const newThread: Thread = {
          id:                    data.thread_id,
          page_number:           0,
          selected_text:         '',
          coordinates:           { x: 0, y: 0, width: 0, height: 0 },
          messages:              [optimisticMsg, assistantMsg],
          parent_thread_id:      null,
          forked_from_message_id: null,
          emoji:                 '💬',
        };
        useAppStore.getState().setActiveThread(newThread);
        setThreads(prev => [...prev, newThread]);
      }
    } catch (err) {
      console.error('[sendStandaloneMessage]', err);
      alert('Failed to send message — check the AI backend (port 8001) is running.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;
    const content = inputMessage;
    setInputMessage('');

    // Standalone mode (no document) → use the Grand Vision AI engine
    if (!documentId) {
      await sendStandaloneMessage(content);
      return;
    }

    // Document mode → existing RAG pipeline on the legacy backend
    if (!activeThread) return;
    await sendMessageToActiveThread(content);
  };

  /** Called by App on logout or view reset. */
  const reset = () => {
    setThreads([]);
    setInputMessage('');
    setPendingForkMsgId(null);
  };

  return {
    threads,
    inputMessage, setInputMessage,
    isSending,
    isCreatingThread,
    pendingForkMsgId,
    treeViewMode, setTreeViewMode,
    handleCreateThread,
    handleQuickAction,
    handleSmartAction,
    handleForkMessage,
    handleSendMessage,
    reset,
  };
}
