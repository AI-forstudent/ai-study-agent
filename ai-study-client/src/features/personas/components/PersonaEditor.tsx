import { useState, useRef, useEffect } from 'react';
import { X, Send, Wand2, Zap, Tag, Save, Copy } from 'lucide-react';
import type { Persona } from '../../../types/persona';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

export interface PersonaEditorProps {
  persona: Persona;
  /**
   *  - 'edit'   : mutates the persona in-place
   *  - 'clone'  : creates a new personal copy of an existing persona
   *  - 'create' : creates a brand-new personal persona from a blank template
   */
  mode: 'edit' | 'clone' | 'create';
  /** When true, footer shows "Apply to Session" (transient) alongside "Save Globally" */
  inSession?: boolean;
  onClose: () => void;
  onSave: (updated: Persona, transient: boolean) => void;
}

// ── AI suggestion chips ────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Make the tone warmer',
  'Add concrete examples',
  'Make it more concise',
  'Add a Socratic element',
  'Enforce stricter output format',
];

// ── Simulated AI reply (backend LLM integration pending) ───────────────────

function mockAIReply(_userMsg: string): string {
  return 'Simulated response — backend LLM integration for persona refinement is pending. Edit the System Prompt directly on the left to adjust this persona.';
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PersonaEditor({
  persona,
  mode,
  inSession = false,
  onClose,
  onSave,
}: PersonaEditorProps) {

  // ── Form state ────────────────────────────────────────────────────────────
  const initialName =
    mode === 'create' ? '' :
    mode === 'clone'  ? `${persona.name} (Clone)` :
    persona.name;

  const [name, setName]               = useState(initialName);
  const [icon, setIcon]               = useState(persona.icon);
  const [systemPrompt, setSystemPrompt] = useState(persona.systemPrompt);
  const [tags, setTags]               = useState<string[]>([...persona.tags]);
  const [tagInput, setTagInput]       = useState('');

  // ── Chat state ────────────────────────────────────────────────────────────
  const initialAssistantMsg =
    mode === 'create'
      ? "Hi! I'm your AI Teacher refinement assistant. Tell me what kind of teacher you want — subject, tone, teaching style — and I'll help you draft the system prompt."
      : `Hi! I'm your AI Teacher refinement assistant. Describe what you want to change about "${persona.name}" and I'll suggest edits to the system prompt.`;

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 0, role: 'assistant', content: initialAssistantMsg },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping]   = useState(false);
  const msgCounter                = useRef(1);
  const chatEndRef                = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // ── Tag helpers ───────────────────────────────────────────────────────────

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag));
  }

  // ── Chat helpers ──────────────────────────────────────────────────────────

  function sendMessage() {
    const text = chatInput.trim();
    if (!text) return;
    const userMsg: ChatMessage = { id: msgCounter.current++, role: 'user', content: text };
    setChatInput('');
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);
    setTimeout(() => {
      const reply: ChatMessage = {
        id: msgCounter.current++,
        role: 'assistant',
        content: mockAIReply(text),
      };
      setMessages(prev => [...prev, reply]);
      setIsTyping(false);
    }, 900);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave(transient: boolean) {
    const base: Persona = {
      ...persona,
      name: name.trim() || persona.name,
      icon: icon || persona.icon,
      systemPrompt,
      tags,
      isTransient: transient,
      updatedAt: new Date().toISOString(),
    };

    const isNewRow = mode === 'clone' || mode === 'create';
    const updated: Persona = isNewRow
      ? {
          ...base,
          id: mode === 'create'
            ? `personal_new_${Date.now()}`
            : `personal_clone_${Date.now()}`,
          type: 'personal',
          author: 'Me',
          rating: 0,
          reviewsCount: 0,
          usageCount: 0,
          wordCount: systemPrompt.trim().split(/\s+/).filter(Boolean).length,
          linkedDocIds: [],
          isCloned: mode === 'clone',
          originalPersonaId: mode === 'clone' ? persona.id : undefined,
          createdAt: new Date().toISOString(),
        }
      : base;

    console.log('INTENT: save persona', { id: updated.id, name: updated.name, transient, mode });
    onSave(updated, transient);
  }

  // ── Live word count ───────────────────────────────────────────────────────

  const liveWordCount = systemPrompt.trim().split(/\s+/).filter(Boolean).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" dir="ltr">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8E8E6] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Wand2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
              {mode === 'create' ? 'Create AI Teacher' :
               mode === 'clone'  ? 'Clone & Edit'      :
                                   'Edit AI Teacher'}
            </p>
            <h1 className="text-sm font-semibold text-[#37352F] leading-tight">
              {mode === 'create' ? 'New AI Teacher' : persona.name}
            </h1>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] transition-colors duration-150"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Split body — stacks on phone, side-by-side on tablet+ ───────────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">

        {/* LEFT: Structured Editor ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-y-auto px-4 py-4 md:px-8 md:py-6 gap-5 md:border-e border-[#E8E8E6]">

          {/* Name + Icon */}
          <div className="flex gap-3 items-end">
            <div className="shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Icon</p>
              <input
                value={icon}
                onChange={e => setIcon(e.target.value)}
                maxLength={2}
                className="w-14 h-10 text-center text-xl border border-[#E8E8E6] rounded-lg bg-[#F7F7F5] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">Name</p>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="AI Teacher name…"
                className="w-full h-10 px-3 border border-[#E8E8E6] rounded-lg text-sm text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">
              <Tag className="w-3 h-3" />
              Tags
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-[#F7F7F5] text-[#787774] border border-[#E8E8E6]"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="text-[#C4C4C4] hover:text-red-400 transition-colors duration-150 leading-none text-sm"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add a tag and press Enter…"
                className="flex-1 h-8 px-3 border border-[#E8E8E6] rounded-lg text-xs text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
              />
              <button
                onClick={addTag}
                className="px-3 h-8 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors duration-150"
              >
                Add
              </button>
            </div>
          </div>

          {/* System Prompt */}
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#787774] mb-1.5">System Prompt</p>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              spellCheck={false}
              className="flex-1 min-h-52 w-full px-4 py-3 border border-[#E8E8E6] rounded-xl text-xs text-[#37352F] font-mono leading-relaxed bg-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
            />
            <p className="mt-1.5 text-[10px] text-[#C4C4C4]">{liveWordCount} words</p>
          </div>
        </div>

        {/* RIGHT: AI Refinement Assistant ──────────────────────────────── */}
        <div className="w-full md:w-[360px] shrink-0 flex flex-col bg-[#F7F7F5] border-t md:border-t-0 border-[#E8E8E6] max-h-[60vh] md:max-h-none">

          {/* Panel header */}
          <div className="px-5 py-4 border-b border-[#E8E8E6] flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Zap className="w-3 h-3 text-indigo-600" />
            </div>
            <span className="text-xs font-semibold text-[#37352F]">AI Refinement Assistant</span>
          </div>

          {/* Suggestion chips */}
          <div className="px-4 pt-3 pb-3 flex flex-wrap gap-1.5 border-b border-[#E8E8E6] shrink-0">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => setChatInput(s)}
                className="text-[10px] font-medium px-2 py-1 rounded-md bg-white border border-[#E8E8E6] text-[#787774] hover:border-indigo-300 hover:text-indigo-600 transition-colors duration-150"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-none'
                      : 'bg-white border border-[#E8E8E6] text-[#37352F] rounded-tl-none'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#E8E8E6] rounded-xl rounded-tl-none px-3 py-2">
                  <span className="inline-flex gap-0.5 items-end text-[#C4C4C4] text-lg leading-none">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div className="px-4 pb-4 pt-3 border-t border-[#E8E8E6] shrink-0">
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Describe what to change…"
                className="flex-1 h-9 px-3 border border-[#E8E8E6] rounded-lg text-xs text-[#37352F] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim()}
                className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:bg-[#E8E8E6] text-white disabled:text-[#C4C4C4] rounded-lg transition-colors duration-150 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-t border-[#E8E8E6] flex items-center justify-between shrink-0 bg-white">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5] rounded-lg border border-[#E8E8E6] transition-colors duration-150"
        >
          Cancel
        </button>
        <div className="flex items-center gap-2">
          {inSession && (
            <>
              <p className="text-xs text-[#787774] me-1">Apply changes:</p>
              <button
                onClick={() => handleSave(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors duration-150"
              >
                <Zap className="w-3.5 h-3.5" />
                This session only
              </button>
            </>
          )}
          <button
            onClick={() => handleSave(false)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
          >
            {mode === 'create'
              ? <><Save className="w-3.5 h-3.5" /> Create AI Teacher</>
              : mode === 'clone'
                ? <><Copy className="w-3.5 h-3.5" /> Save as Clone</>
                : <><Save className="w-3.5 h-3.5" /> Save Changes</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
