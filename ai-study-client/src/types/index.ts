export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

export interface Thread {
  id: number;
  selected_text: string;
  coordinates: { x: number, y: number };
  messages: Message[];
  // הוספנו את השדות של העץ (מסומנים עם סימן שאלה כי יכול להיות להם ערך null בשיחות שורש)
  parent_thread_id?: number | null;
  forked_from_message_id?: number | null;
}