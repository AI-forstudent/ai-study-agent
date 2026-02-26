import { create } from 'zustand';
import type { Thread } from '../types'; 

// 1. הגדרת הממשק: איזה מידע המחסן שלנו יחזיק?
interface AppState {
  // --- הנתונים (State) ---
  textSelection: { text: string; x: number; y: number } | null;
  activeThread: Thread | null;
  

  setTextSelection: (selection: { text: string; x: number; y: number } | null) => void;
  setActiveThread: (thread: Thread | null) => void;
  clearSelection: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  textSelection: null,
  activeThread: null,

  // פונקציה לעדכון הטקסט המסומן והקואורדינטות שלו (תופעל כשהמשתמש יסמן ב-PDF)
  setTextSelection: (selection) => set({ textSelection: selection }),
  
  // פונקציה לעדכון השיחה הפעילה בצ'אט
  setActiveThread: (thread) => set({ activeThread: thread }),

  // פונקציית נוחות לניקוי מהיר של הבחירה
  clearSelection: () => set({ textSelection: null }),
}));