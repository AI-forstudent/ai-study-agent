export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

export interface Thread {
  id: number;
  page_number: number;  // <--- הוספנו את חותמת העמוד!
  document_id?: number; // על הדרך, בוא נוסיף גם את זה למקרה שנצטרך
  selected_text: string;
  coordinates: { x: number, y: number, width: number, height: number };
  messages: Message[];
  parent_thread_id?: number | null;
  forked_from_message_id?: number | null;
  title?: string; 
  emoji?: string;
}