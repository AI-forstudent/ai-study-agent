
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
}