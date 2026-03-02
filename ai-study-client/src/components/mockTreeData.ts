import type { Thread } from '../types';

export const mockThreads: Thread[] = [
  // --- שיחת שורש ---
  {
    id: 1,
    selected_text: "[שורש] מודל שפה גדול (LLM) הוא מודל בינה מלאכותית...",
    coordinates: { x: 100, y: 200 },
    messages: [
      { id: 101, role: 'user', content: 'תוכל להסביר לי את הפסקה הזו במילים פשוטות?' },
      { id: 102, role: 'assistant', content: 'בטח! מודל שפה גדול (LLM) הוא כמו מוח וירטואלי שקרא כמעט את כל האינטרנט. הוא מנחש מה המילה הבאה שצריכה להופיע במשפט.' },
      { id: 103, role: 'user', content: 'רגע, אז הוא לא באמת "חושב"?' },
      { id: 104, role: 'assistant', content: 'שאלה מצוינת. הוא לא חושב כמו בן אדם, אלא משתמש בסטטיסטיקה והסתברות כדי לייצר טקסט שנראה הגיוני.' },
      { id: 105, role: 'user', content: 'הבנתי. ומה לגבי בעיות אבטחה בזה?' },
      { id: 106, role: 'assistant', content: 'יש לא מעט אתגרים, כמו הלוצינציות (המצאת עובדות) או דליפת מידע פרטי מהמידע שעליו הוא אומן.' },
    ]
  },
  // --- ילד 1 של השורש ---
  {
    id: 2,
    parent_thread_id: 1,
    forked_from_message_id: 104,
    selected_text: "[פיצול רמה 1] משתמש בסטטיסטיקה והסתברות...",
    coordinates: { x: 120, y: 220 },
    messages: [
      { id: 201, role: 'user', content: 'איך בדיוק הסטטיסטיקה הזו עובדת? יש נוסחה?' },
      { id: 202, role: 'assistant', content: 'כן, המודלים משתמשים ברשתות נוירונים, ספציפית בארכיטקטורה שנקראת Transformer. היא מחשבת את "תשומת הלב" (Attention) בין מילים שונות.' },
      { id: 203, role: 'user', content: 'זה נשמע מסובך, אפשר דוגמה למנגנון Attention?' },
      { id: 204, role: 'assistant', content: 'תחשוב על משפט כמו "הבנק שלי סגור, אז ישבתי על הגדה של הנהר (Bank)". מנגנון תשומת הלב מבין שהמילה Bank פה קשורה לנהר ולא למוסד פיננסי בזכות המילים שמסביבה.' }
    ]
  },
  // --- ילד 2 של השורש ---
  {
    id: 3,
    parent_thread_id: 1,
    forked_from_message_id: 106,
    selected_text: "[פיצול רמה 1] הלוצינציות (המצאת עובדות)...",
    coordinates: { x: 130, y: 250 },
    messages: [
      { id: 301, role: 'user', content: 'למה הוא ממציא עובדות?' },
      { id: 302, role: 'assistant', content: 'כי המטרה העיקרית שלו היא לייצר טקסט ש*נשמע* הגיוני וזורם, גם אם הוא לא מצא מידע מדויק במסד הנתונים שלו. הוא מעדיף לתת תשובה מלאה מאשר להגיד "לא יודע".' }
    ]
  },
  // --- נכד (ילד של ילד 1) ---
  {
    id: 4,
    parent_thread_id: 2,
    forked_from_message_id: 202,
    selected_text: "[פיצול רמה 2] ארכיטקטורה שנקראת Transformer",
    coordinates: { x: 140, y: 240 },
    messages: [
      { id: 401, role: 'user', content: 'מי המציא את ה-Transformer הזה?' },
      { id: 402, role: 'assistant', content: 'הוא הוצג לראשונה בשנת 2017 על ידי חוקרים בגוגל במאמר פורץ דרך.' },
      { id: 403, role: 'user', content: 'איך קראו למאמר?' },
      { id: 404, role: 'assistant', content: 'למאמר קראו "Attention Is All You Need".' }
    ]
  }
];

export interface TreeStrategyProps {
  threads: Thread[];
  activeThread: Thread | null;
  onSelectThread: (thread: Thread) => void;
  onEnterChat: (thread: Thread) => void; // <--- השורה החדשה שהוספנו!
}