export type PersonaType = 'global' | 'community' | 'personal';
export type TagCategory = 'knowledge' | 'personality' | 'instructions' | 'extra' | 'style';

export interface Persona {
  id: string;
  name: string;
  description: string;
  icon: string; // Emoji character
  type: PersonaType;
  author: string; // "System", User's name, or Community name
  communityId?: string; // e.g., "bgu_data_eng"
  tags: string[]; // e.g., ["Python", "Strict", "Hebrew"]
  tagTypes?: Record<string, TagCategory>; // maps each tag to its functional category
  rating: number; // 1.0 to 5.0
  reviewsCount: number;
  usageCount: number; // How many times it was used or cloned
  wordCount: number; // Total words in effective context (system prompt + linked doc excerpts)
  linkedDocIds: number[]; // IDs of associated documents in the user's library
  systemPrompt: string; // The actual prompt sent to the LLM
  isCloned: boolean;
  isTransient?: boolean; // When true, changes apply only to the current session
  originalPersonaId?: string; // If cloned, points to the original global/community ID
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}
