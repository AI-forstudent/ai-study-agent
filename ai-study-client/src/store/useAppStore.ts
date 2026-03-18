import { create } from 'zustand';
import type { Thread } from '../types'; 

// 1. הגדרת הממשק: איזה מידע המחסן שלנו יחזיק?
interface AppState {
  // --- הנתונים (State) ---
  // הוספנו את ה-width וה-height לכאן:
  textSelection: { text: string; x: number; y: number; width: number; height: number } | null;
  activeThread: Thread | null;
  
  // צריך לעדכן גם את החתימה של הפונקציה שמקבלת את הנתונים:
  setTextSelection: (selection: { text: string; x: number; y: number; width: number; height: number } | null) => void;
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