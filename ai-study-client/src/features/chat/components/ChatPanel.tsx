import React, { useMemo, useRef, useState } from 'react';
import { Send, Bot, User as UserIcon, MessageSquare, GitBranch, Network, FileText, Sparkles, Loader2, Wand2, BookOpen, Settings2, AlignLeft, Zap, Copy, Check, Paperclip, ChevronDown, ChevronRight, Mic as MicIcon, Image as ImageIconLR, ArrowLeft, Plus, RefreshCw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import type { Thread, Message } from '../../../types';
import { BreadcrumbTree } from './BreadcrumbTree';
import { MillerColumnsTree } from './MillerColumnsTree';
import { NodeGraphTree } from './NodeGraphTree';
import { api } from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import SwitchPersonaModal from '../../personas/components/SwitchPersonaModal';

// ── Model picker config ───────────────────────────────────────────────────
// The user wants the picker right next to the chat input. The set mirrors the
// previous WorkspaceHeader picker so power users keep the same controls; an
// "Auto" option is reserved for a future smart-router (TODO: backend).

type AIProvider = 'openai' | 'anthropic' | 'gemini';

const AI_PROVIDERS: { value: AIProvider; label: string; title: string; dot: string }[] = [
  { value: 'openai',    label: 'GPT',    title: 'OpenAI — GPT series',     dot: 'bg-emerald-500' },
  { value: 'anthropic', label: 'Claude', title: 'Anthropic — Claude',      dot: 'bg-orange-500'  },
  { value: 'gemini',    label: 'Gemini', title: 'Google — Gemini',         dot: 'bg-blue-500'    },
];

const MODEL_TIERS: { value: 'flash-lite' | 'flash' | 'pro'; label: string; title: string }[] = [
  { value: 'flash-lite', label: 'Fast',     title: 'Fast & Efficient' },
  { value: 'flash',      label: 'Balanced', title: 'Balanced'         },
  { value: 'pro',        label: 'Deep',     title: 'Deep Analysis'    },
];

interface ChatPanelProps {
  documentId: number | null;
  activeThread: Thread | null;
  threads: Thread[];
  setActiveThread: (thread: Thread | null) => void;
  inputMessage: string;
  setInputMessage: (msg: string) => void;
  handleSendMessage: () => void;
  isSending: boolean;
  onForkMessage: (messageId: number) => void;
  pendingForkMsgId: number | null;
  treeViewMode: 'miller' | 'breadcrumbs' | 'graph';
  currentPage: number;
  /** Name of the active persona (null = No Agent, undefined = prop not provided / no session started) */
  activePersonaName?: string | null;
  /** ID of the active persona (null = No Agent, undefined = no session started) */
  activePersonaId?: string | null;
  /** Called when the user confirms a mid-session persona switch */
  onSwitchPersona?: (newId: string | null, keepContext: boolean) => void;
  /** F-020 — uploads the picked file, attaches it to the active thread (or
   *  creates a doc-anchored thread on the fly), and switches the workspace
   *  to PDF + chat split. Hidden when the workspace already has a doc. */
  onAttachFile?: (file: File) => Promise<void>;
}

const SummaryLoader = () => (
  <div className="mt-5 space-y-3">
    <div className="flex items-center gap-2 text-[#787774] text-xs mb-4">
      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
      Generating summary…
    </div>
    <div className="h-3 bg-[#EFEFED] rounded-full w-full animate-pulse" />
    <div className="h-3 bg-[#EFEFED] rounded-full w-5/6 animate-pulse" />
    <div className="h-3 bg-[#EFEFED] rounded-full w-4/6 animate-pulse" />
  </div>
);

const summaryMdComponents = {
  p:      ({ node, ...props }: any) => <p dir="auto" {...props} />,
  li:     ({ node, ...props }: any) => <li dir="auto" {...props} />,
  h1:     ({ node, ...props }: any) => <h1 dir="auto" className="text-xl font-semibold mt-4 mb-2" {...props} />,
  h2:     ({ node, ...props }: any) => <h2 dir="auto" className="text-lg font-semibold mt-3 mb-2" {...props} />,
  h3:     ({ node, ...props }: any) => <h3 dir="auto" className="text-base font-semibold mt-2 mb-1" {...props} />,
  strong: ({ node, ...props }: any) => <strong className="text-[#37352F] font-semibold" {...props} />,
};

// ── Code block with copy button (assistant chat messages) ─────────────────
// Used as the renderer for fenced code blocks in markdown — wraps the content
// in a chrome strip showing the language label + a copy-to-clipboard button.
// Inline code (single-backtick) renders through `inlineCode` separately.
function CodeBlockWithCopy({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (insecure context) — silently no-op.
    }
  };
  return (
    <div className="not-prose my-3 rounded-lg border border-[#E8E8E6] bg-[#F7F7F5] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#E8E8E6] text-[10px] uppercase tracking-wide text-[#787774] font-medium">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[#787774] hover:text-[#37352F] hover:bg-[#EFEFED] transition-colors duration-150"
          title="Copy to clipboard"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
        <code className="font-mono text-[#37352F]">{code}</code>
      </pre>
    </div>
  );
}

// ── Markdown renderer config used by assistant chat messages ──────────────
// Document-style: full markdown surface (headings, lists, tables, code blocks
// with copy, blockquotes, hr, KaTeX) with comfortable typography. Distinct
// from `summaryMdComponents` because the chat bubble lives outside `prose`
// in this design (we don't want the prose plugin's bubble-tight overrides).
const assistantMdComponents = {
  p:          ({ node, ...props }: any) => <p dir="auto" {...props} />,
  li:         ({ node, ...props }: any) => <li dir="auto" {...props} />,
  h1:         ({ node, ...props }: any) => <h1 dir="auto" className="text-xl font-bold text-[#37352F] mt-5 mb-2" {...props} />,
  h2:         ({ node, ...props }: any) => <h2 dir="auto" className="text-lg font-bold text-[#37352F] mt-4 mb-2" {...props} />,
  h3:         ({ node, ...props }: any) => <h3 dir="auto" className="text-base font-semibold text-[#37352F] mt-3 mb-1.5" {...props} />,
  h4:         ({ node, ...props }: any) => <h4 dir="auto" className="text-sm font-semibold text-[#37352F] mt-2 mb-1" {...props} />,
  strong:     ({ node, ...props }: any) => <strong className="text-[#37352F] font-semibold" {...props} />,
  blockquote: ({ node, ...props }: any) => (
    <blockquote dir="auto" className="border-s-4 border-indigo-200 bg-indigo-50/40 ps-4 pe-3 py-2 my-3 text-[#37352F] italic" {...props} />
  ),
  hr:         () => <hr className="my-5 border-t border-[#E8E8E6]" />,
  table:      ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-4 not-prose">
      <table className="border-collapse border border-[#E8E8E6] w-full rounded-lg text-sm" {...props} />
    </div>
  ),
  th:         ({ node, ...props }: any) => (
    <th dir="auto" className="border border-[#E8E8E6] bg-[#F7F7F5] p-2 font-semibold text-[#37352F] text-start" {...props} />
  ),
  td:         ({ node, ...props }: any) => (
    <td dir="auto" className="border border-[#E8E8E6] p-2 text-[#37352F] text-start" {...props} />
  ),
  // react-markdown v10: code blocks have className="language-xxx"; inline
  // single-backtick code has no className. We dispatch on that to render a
  // chrome strip + copy button for blocks vs. plain inline pill for inline.
  code: ({ inline, className, children, ...rest }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const text = String(children).replace(/\n$/, '');
    if (!inline && match) {
      return <CodeBlockWithCopy language={match[1]} code={text} />;
    }
    if (!inline && text.includes('\n')) {
      // Fenced block without a language hint — still render with copy.
      return <CodeBlockWithCopy language="" code={text} />;
    }
    return (
      <code className="px-1.5 py-0.5 rounded bg-[#F7F7F5] border border-[#E8E8E6] text-[0.85em] font-mono text-[#37352F]" {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }: any) => <>{children}</>,
};

const SummaryContent = ({ text }: { text: string }) => (
  <div className="mt-4 bg-[#F7F7F5] p-4 rounded-xl border border-[#E8E8E6] prose prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-[#37352F] prose-p:text-[#37352F]">
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex]}
      components={summaryMdComponents}
    >
      {text}
    </ReactMarkdown>
  </div>
);

const ChatPanel: React.FC<ChatPanelProps> = ({
  documentId,
  activeThread,
  threads,
  setActiveThread,
  inputMessage,
  setInputMessage,
  handleSendMessage,
  isSending,
  onForkMessage,
  pendingForkMsgId,
  treeViewMode,
  currentPage,
  activePersonaName,
  activePersonaId,
  onSwitchPersona,
  onAttachFile,
}) => {
  // F-036 — when a lecture session is active, surface a "Lecture" tab
  // with the unified summary + lecturer / student / recording / notes
  // accordion. Clicking an item swaps the active document.
  const activeLecture     = useAppStore(s => s.activeLecture);
  const setActiveLecture  = useAppStore(s => s.setActiveLecture);
  // Default tab when entering a session: 'lecture' if the user just
  // opened a lecture; 'tree' otherwise. Sending a message auto-flips
  // to 'chat' (see the send handlers below).
  const [activeTab, setActiveTab] = useState<'tree' | 'chat' | 'summary' | 'lecture'>(
    activeLecture ? 'lecture' : 'tree',
  );
  // When the user opens a different lecture mid-session, default back
  // to the Lecture tab so the new context is visible.
  const lectureIdSeen = useRef<number | null>(activeLecture?.id ?? null);
  React.useEffect(() => {
    const id = activeLecture?.id ?? null;
    if (id !== lectureIdSeen.current) {
      lectureIdSeen.current = id;
      if (id != null) setActiveTab('lecture');
    }
  }, [activeLecture?.id]);
  const [isAttaching, setIsAttaching] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // F-020 — paperclip handler. Uploads, attaches to the active thread (or
  // creates a doc-anchored one), then switches the workspace to doc-anchored.
  // Hidden when the workspace already has a doc — adding multiple docs to
  // a single thread is the M2M-attachments enhancement (deferred).
  const showAttachButton = !documentId && !!onAttachFile;
  const handleAttachClick = () => {
    if (isAttaching) return;
    attachInputRef.current?.click();
  };
  const handleAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // reset so picking the same file twice still fires onChange
    if (!file || !onAttachFile) return;
    setIsAttaching(true);
    try {
      await onAttachFile(file);
    } catch (err) {
      console.error('[ChatPanel] attach failed', err);
      alert('Failed to attach the document. Please try again.');
    } finally {
      setIsAttaching(false);
    }
  };
  const [pageSummaries, setPageSummaries] = useState<Record<number, string>>({});
  const [fullDocSummary, setFullDocSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryMode, setSummaryMode] = useState<'current' | 'all' | 'custom'>('current');
  const [customPrompt, setCustomPrompt] = useState('');
  const [customResult, setCustomResult] = useState<string | null>(null);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);

  // Model picker — pulled from the global store so the WorkspaceHeader copy
  // (now removed) and the chat-input copy stay in sync if we ever add a second.
  const selectedAIProvider    = useAppStore(s => s.selectedAIProvider);
  const setSelectedAIProvider = useAppStore(s => s.setSelectedAIProvider);
  const selectedModelTier     = useAppStore(s => s.selectedModelTier);
  const setSelectedModelTier  = useAppStore(s => s.setSelectedModelTier);

  React.useEffect(() => {
    if (!documentId) {
      setPageSummaries({});
      return;
    }
    api.getDocumentSummaries(documentId)
      .then(res => {
        const summariesMap: Record<number, string> = {};
        res.data.forEach((item: any) => { summariesMap[item.page_number] = item.summary; });
        setPageSummaries(summariesMap);
      })
      .catch(err => console.error('Failed to load existing summaries', err));
  }, [documentId]);

  const handleGenerateSummary = async () => {
    if (!documentId) return;
    setIsGeneratingSummary(true);
    try {
      const res = await api.createPageSummary(documentId, currentPage);
      setPageSummaries(prev => ({ ...prev, [currentPage]: res.data.summary }));
    } catch {
      alert('Failed to generate summary. Please try again.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleGenerateAll = async () => {
    if (!documentId) return;
    setIsGeneratingSummary(true);
    try {
      const res = await api.createFullDocumentSummary(documentId);
      setFullDocSummary(res.data.summary);
    } catch {
      alert('Failed to generate full document summary. Please try again.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleGenerateCustom = async () => {
    if (!documentId || !customPrompt.trim()) return;
    setIsGeneratingSummary(true);
    try {
      const res = await api.createCustomSummary(documentId, customPrompt);
      setCustomResult(res.data.summary);
    } catch {
      alert('Failed to generate custom summary. Please try again.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSelectThread = (thread: Thread) => setActiveThread(thread);

  React.useEffect(() => {
    if (!documentId) setActiveTab('chat');
  }, [documentId]);

  const handleEnterChat = (thread: Thread) => {
    setActiveThread(thread);
    setActiveTab('chat');
  };

  // ── Message renderer ───────────────────────────────────────────────────────
  // User messages render as compact gray bubbles (right-aligned, capped at
  // 85%). Assistant messages render document-style — full width, no card
  // chrome, comfortable typography — so long-form rich-markdown answers
  // (headings, tables, code blocks, math) feel like reading a Notion page
  // rather than a chat balloon. The fork button stays on assistant messages.
  const renderMessage = (
    msg: Message,
    allThreads: Thread[],
    currentThread: Thread,
    setThread: Function,
    forkHandler: Function,
    pendingId: number | null,
  ) => {
    const forkButton = msg.role === 'assistant' && (() => {
      const isForkActiveInDB = currentThread.forked_from_message_id === msg.id;
      const isPendingFork    = pendingId === msg.id;

      let btnClass = 'text-[#787774] border border-[#E8E8E6] hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50';
      let btnText  = 'Fork thread';
      let btnTitle = 'Start a new branch from this message';
      let onClickHandler: () => void = () => forkHandler(msg.id);

      if (isForkActiveInDB) {
        btnClass = 'bg-indigo-50 text-indigo-700 border border-indigo-200';
        btnText  = 'Fork active — click to return';
        btnTitle = 'Deactivate fork and return to parent thread';
        onClickHandler = () => {
          const parent = allThreads.find(t => t.id === currentThread.parent_thread_id);
          if (parent) setThread(parent);
        };
      } else if (isPendingFork) {
        btnClass = 'bg-amber-50 text-amber-700 border border-amber-200';
        btnText  = 'Pending fork — click to cancel';
        btnTitle = 'Cancel planned fork';
        onClickHandler = () => forkHandler(msg.id);
      }

      return (
        <button
          onClick={onClickHandler}
          className={`self-start flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 ${btnClass}`}
          title={btnTitle}
        >
          <GitBranch size={12} />
          {btnText}
        </button>
      );
    })();

    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex gap-3 flex-row-reverse">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[#EFEFED] text-[#787774]">
            <UserIcon size={14} />
          </div>
          <div className="flex flex-col gap-1.5 max-w-[85%]">
            <div
              className="p-3 text-sm leading-relaxed bg-[#F7F7F5] text-[#37352F] border border-[#E8E8E6] rounded-xl rounded-tr-none whitespace-pre-wrap"
              dir="auto"
            >
              {msg.content}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className="flex gap-3">
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600">
          <Bot size={14} />
        </div>
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <article className="prose prose-base max-w-none text-[#37352F] prose-headings:text-[#37352F] prose-strong:text-[#37352F] prose-a:text-indigo-600 prose-p:leading-relaxed prose-li:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-0 leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkMath, remarkGfm]}
              rehypePlugins={[rehypeKatex]}
              components={assistantMdComponents as any}
            >
              {msg.content}
            </ReactMarkdown>
          </article>
          {forkButton}
        </div>
      </div>
    );
  };

  // ── Tab helpers ────────────────────────────────────────────────────────────
  const tabBase = 'flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium border-b-2 transition-colors duration-150';
  const tabActive = 'border-indigo-600 text-indigo-600 bg-white';
  const tabInactive = 'border-transparent text-[#787774] hover:bg-[#EFEFED]';

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="w-full bg-white sm:border sm:border-[#E8E8E6] sm:rounded-xl flex flex-col overflow-hidden h-full max-h-full">

      {/* ── Switch Persona Modal ──────────────────────────────────────── */}
      <SwitchPersonaModal
        isOpen={isSwitchModalOpen}
        currentPersonaId={activePersonaId ?? null}
        currentPersonaName={activePersonaName ?? null}
        onClose={() => setIsSwitchModalOpen(false)}
        onSwitch={(newId, keepContext) => {
          onSwitchPersona?.(newId, keepContext);
          setIsSwitchModalOpen(false);
        }}
      />

      {/* ── Tabs (only when there are multiple tabs to choose between) ──── */}
      {(documentId !== null || activeLecture) && (
        <div className="flex bg-[#F7F7F5] border-b border-[#E8E8E6] shrink-0 overflow-x-auto">
          {activeLecture && (
            <button
              onClick={() => setActiveTab('lecture')}
              className={`${tabBase} ${activeTab === 'lecture' ? tabActive : tabInactive}`}
            >
              <BookOpen className="w-3.5 h-3.5" /> Lecture
            </button>
          )}
          <button
            onClick={() => setActiveTab('tree')}
            className={`${tabBase} ${activeTab === 'tree' ? tabActive : tabInactive}`}
          >
            <Network className="w-3.5 h-3.5" /> Threads
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`${tabBase} ${activeTab === 'chat' ? tabActive : tabInactive}`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Active Chat
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`${tabBase} ${activeTab === 'summary' ? tabActive : tabInactive}`}
          >
            <FileText className="w-3.5 h-3.5" /> Summary
          </button>
        </div>
      )}

      {/* ── Lecture tab (F-036) ────────────────────────────────────────── */}
      {activeTab === 'lecture' && activeLecture && (
        <LectureAccordionPane
          lecture={activeLecture}
          activeDocumentId={documentId}
          onClose={() => setActiveLecture(null)}
        />
      )}

      {/* ── Thread tree tab ────────────────────────────────────────────── */}
      {activeTab === 'tree' && (
        <div className="flex-1 flex flex-col p-5 overflow-y-auto bg-[#F7F7F5]/40">
          {(() => {
            const strategyProps = { threads, activeThread, onSelectThread: handleSelectThread, onEnterChat: handleEnterChat };
            switch (treeViewMode) {
              case 'breadcrumbs': return <BreadcrumbTree {...strategyProps} />;
              case 'graph':       return <NodeGraphTree {...strategyProps} />;
              case 'miller':
              default:            return <MillerColumnsTree {...strategyProps} />;
            }
          })()}
        </div>
      )}

      {/* ── Summary tab ───────────────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="flex-1 flex flex-col p-5 overflow-y-auto gap-4">

          {/* Mode selector pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSummaryMode('current')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors duration-150 ${
                summaryMode === 'current'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-[#787774] border-[#E8E8E6] hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              <AlignLeft className="w-3 h-3" />
              Current Page
            </button>
            <button
              onClick={() => setSummaryMode('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors duration-150 ${
                summaryMode === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-[#787774] border-[#E8E8E6] hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              <BookOpen className="w-3 h-3" />
              Summarize All
            </button>
            <button
              onClick={() => setSummaryMode('custom')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors duration-150 ${
                summaryMode === 'custom'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-[#787774] border-[#E8E8E6] hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              <Settings2 className="w-3 h-3" />
              Custom
            </button>
          </div>

          {/* ── Current Page mode ── */}
          {summaryMode === 'current' && (
            <div className="bg-white rounded-xl border border-[#E8E8E6] p-5">
              <h3 className="text-sm font-semibold text-[#37352F] mb-1 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Page {currentPage} Summary
              </h3>
              {!pageSummaries[currentPage] && !isGeneratingSummary && (
                <div className="mt-6 flex flex-col items-center gap-3 text-center">
                  <p className="text-xs text-[#787774]">No summary yet for this page.</p>
                  <button
                    onClick={handleGenerateSummary}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-150"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate Summary
                  </button>
                </div>
              )}
              {isGeneratingSummary && <SummaryLoader />}
              {pageSummaries[currentPage] && !isGeneratingSummary && (
                <SummaryContent text={pageSummaries[currentPage]} />
              )}
            </div>
          )}

          {/* ── Summarize All mode ── */}
          {summaryMode === 'all' && (
            <div className="bg-white rounded-xl border border-[#E8E8E6] p-5">
              <h3 className="text-sm font-semibold text-[#37352F] mb-1 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Full Document Summary
              </h3>
              {!fullDocSummary && !isGeneratingSummary && (
                <div className="mt-6 flex flex-col items-center gap-3 text-center">
                  <p className="text-xs text-[#787774]">Generate a comprehensive summary of the entire document.</p>
                  <button
                    onClick={handleGenerateAll}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-150"
                  >
                    <BookOpen className="w-4 h-4" />
                    Summarize All
                  </button>
                </div>
              )}
              {isGeneratingSummary && <SummaryLoader />}
              {fullDocSummary && !isGeneratingSummary && (
                <SummaryContent text={fullDocSummary} />
              )}
            </div>
          )}

          {/* ── Custom mode ── */}
          {summaryMode === 'custom' && (
            <div className="bg-white rounded-xl border border-[#E8E8E6] p-5 flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-[#37352F] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Custom Summary
              </h3>
              <textarea
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder="e.g. List all key definitions, Explain the main argument in simple terms, Summarize only the conclusions…"
                dir="auto"
                rows={3}
                className="w-full border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none transition-colors duration-150"
              />
              <button
                onClick={handleGenerateCustom}
                disabled={!customPrompt.trim() || isGeneratingSummary}
                className="self-start flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-150"
              >
                <Sparkles className="w-4 h-4" />
                Generate
              </button>
              {isGeneratingSummary && <SummaryLoader />}
              {customResult && !isGeneratingSummary && (
                <SummaryContent text={customResult} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Active chat tab ────────────────────────────────────────────── */}
      {activeTab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 bg-white">

            {/* Context banner — only meaningful for threads anchored to a
                text selection in a document. Standalone /chat threads carry
                an empty `selected_text` and rendering the banner with empty
                quotes is just noise (B-011). */}
            {activeThread && activeThread.selected_text?.trim() && (
              <div className="bg-[#F7F7F5] border border-[#E8E8E6] p-3 rounded-lg text-xs text-[#787774] mb-4">
                <span className="font-medium text-[#37352F] block mb-1">
                  {activeThread.emoji || '📌'} Context (selected text):
                </span>
                <span className="italic">"{activeThread.selected_text}"</span>
              </div>
            )}

            {(() => {
              const forkId        = activeThread?.forked_from_message_id;
              const historicalMsgs = forkId ? activeThread?.messages?.filter(m => m.id <= forkId) : [];
              const currentMsgs   = forkId ? activeThread?.messages?.filter(m => m.id > forkId)  : activeThread?.messages;

              return (
                <>
                  {historicalMsgs && historicalMsgs.length > 0 && (
                    <details className="group mb-5">
                      <summary className="cursor-pointer text-xs font-medium text-[#787774] bg-[#EFEFED] hover:bg-[#E8E8E6] px-4 py-2 rounded-full mx-auto w-fit transition-colors duration-150 flex items-center gap-2 select-none">
                        <span>Show previous history ({historicalMsgs.length} messages)</span>
                        <Network size={12} className="group-open:rotate-180 transition-transform" />
                      </summary>
                      <div className="mt-4 space-y-4 opacity-60 border-s-2 border-[#E8E8E6] ps-4 ms-2">
                        {historicalMsgs.map(msg => renderMessage(msg, threads, activeThread!, setActiveThread, onForkMessage, pendingForkMsgId))}
                      </div>
                    </details>
                  )}

                  {currentMsgs?.map(msg => renderMessage(msg, threads, activeThread!, setActiveThread, onForkMessage, pendingForkMsgId))}
                </>
              );
            })()}

            {isSending && (
              <div className="flex gap-3">
                <div className="w-7 h-7 bg-indigo-50 text-indigo-300 rounded-full flex items-center justify-center shrink-0">
                  <Bot size={14} />
                </div>
                <div className="p-4 rounded-xl rounded-tl-none w-full max-w-[85%] bg-white border border-[#E8E8E6]">
                  <div className="animate-pulse flex flex-col gap-2.5">
                    <div className="h-2 bg-[#EFEFED] rounded-full w-3/4" />
                    <div className="h-2 bg-[#EFEFED] rounded-full w-full" />
                    <div className="h-2 bg-[#EFEFED] rounded-full w-1/2" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Persona + model picker — single bottom controls row */}
          <div className="px-4 pt-2 pb-1 bg-white border-t border-[#E8E8E6] flex items-center gap-2 flex-wrap text-xs">
            {activePersonaName !== undefined && (
              <>
                <button
                  onClick={() => setIsSwitchModalOpen(true)}
                  title="Change AI Teacher for this session"
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#E8E8E6] bg-white text-[#37352F] hover:border-indigo-300 hover:text-indigo-600 transition-colors duration-150"
                >
                  <Wand2 className="w-3 h-3 text-indigo-500" />
                  <span className="font-medium">{activePersonaName ?? 'No Agent'}</span>
                </button>
                <span className="mx-1 w-px h-4 bg-[#E8E8E6]" />
              </>
            )}
            <span className="flex items-center gap-1 text-[#C4C4C4] me-1">
              <Zap className="w-3 h-3" />
              Model
            </span>
            {AI_PROVIDERS.map(p => {
              const isActive = selectedAIProvider === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() => setSelectedAIProvider(p.value)}
                  title={p.title}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors duration-150 ${
                    isActive
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium'
                      : 'bg-white border-[#E8E8E6] text-[#787774] hover:border-[#C4C4C4] hover:text-[#37352F]'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />
                  {p.label}
                </button>
              );
            })}
            <span className="mx-1 w-px h-4 bg-[#E8E8E6]" />
            <div className="flex items-center bg-[#F7F7F5] border border-[#E8E8E6] rounded-md p-0.5">
              {MODEL_TIERS.map(tier => (
                <button
                  key={tier.value}
                  onClick={() => setSelectedModelTier(tier.value)}
                  title={tier.title}
                  className={`px-2 py-0.5 rounded transition-colors duration-150 ${
                    selectedModelTier === tier.value
                      ? 'bg-white text-[#37352F] border border-[#E8E8E6] font-medium'
                      : 'text-[#787774] hover:text-[#37352F]'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input bar — taller touch targets on phone, padded for safe area */}
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-white border-t border-[#E8E8E6] flex gap-2 shrink-0 items-center pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            {showAttachButton && (
              <>
                <input
                  ref={attachInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.md,.py,.js,.ts,.tsx,.jsx,.go,.rs,.java,.c,.cpp,.h,.hpp"
                  className="hidden"
                  onChange={handleAttachChange}
                />
                <button
                  type="button"
                  onClick={handleAttachClick}
                  disabled={isAttaching}
                  title="Attach a document to this conversation"
                  className="p-2.5 sm:p-2 rounded-lg text-[#787774] hover:text-indigo-600 hover:bg-[#F7F7F5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                >
                  {isAttaching
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Paperclip className="w-4 h-4" />}
                </button>
              </>
            )}
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Continue the conversation…"
              dir="auto"
              className="flex-1 min-w-0 border border-[#E8E8E6] rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isSending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 sm:p-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatPanel;


// ══════════════════════════════════════════════════════════════════════════
// F-036 — Lecture accordion pane
// ══════════════════════════════════════════════════════════════════════════
// Lives inside the ChatPanel "Lecture" tab. Lists the lecture's summaries /
// recordings / notes and lets the user swap the active document. Audio
// recordings + image notes render inline (they don't fit PdfViewer). PDF
// items (unified, lecturer, student, notes-PDF) dispatch a document switch
// to App.tsx via the pendingDocumentSwitch store value.

const UPLOADS_BASE_FOR_LECTURE = (import.meta.env.VITE_AI_API_URL ?? '').replace(/\/$/, '');
function lectureAttachmentUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const clean = filePath.replace(/^\/+/, '');
  return `${UPLOADS_BASE_FOR_LECTURE}/${clean}`;
}

interface LectureAccordionPaneProps {
  lecture: any;
  activeDocumentId: number | null;
  onClose: () => void;
}

function LectureAccordionPane({ lecture, activeDocumentId, onClose }: LectureAccordionPaneProps) {
  const setPendingDocumentSwitch = useAppStore(s => s.setPendingDocumentSwitch);
  const setActiveLecture         = useAppStore(s => s.setActiveLecture);
  const [open, setOpen] = useState({
    lecturer:  true,
    student:   (lecture.student_summaries?.length ?? 0) > 0,
    recording: (lecture.recordings?.length ?? 0) > 0,
    note:      (lecture.notes?.length ?? 0) > 0,
  });
  const [inlineAudio, setInlineAudio] = useState<{ id: number; title: string; url: string } | null>(null);
  const [inlineImage, setInlineImage] = useState<{ id: number; title: string; url: string } | null>(null);
  // F-036.1 — owner-only uploads from inside the accordion. The backend
  // enforces owner-only; we surface the affordance to everyone and let
  // the API return 404 for non-owners (mirrors how documents.py handles
  // unauthorized writes elsewhere).
  const [uploading, setUploading] = useState<'lecturer' | 'student' | 'recording' | 'note' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const lecturerInputRef  = useRef<HTMLInputElement>(null);
  const studentInputRef   = useRef<HTMLInputElement>(null);
  const recordingInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef     = useRef<HTMLInputElement>(null);

  // F-036.2 — unified summary generation: kicks off the BG task, polls
  // while `unified_summary_processing=true`, and auto-switches the main
  // pane to the rendered PDF the moment it lands.
  const [genStarting, setGenStarting] = useState(false);
  const [pickerOpen,  setPickerOpen]  = useState(false);

  async function refreshLecture(): Promise<any | null> {
    try {
      const res = await api.getLecture(lecture.id);
      setActiveLecture(res.data);
      return res.data;
    } catch {
      // best-effort — leave the stale lecture in store on failure
      return null;
    }
  }

  // Poll while a generation is in flight, refresh on completion, and
  // jump the main pane to the rendered PDF when it shows up.
  React.useEffect(() => {
    if (!lecture.unified_summary_processing) return;
    let cancelled = false;
    const tick = async () => {
      const fresh = await refreshLecture();
      if (cancelled || !fresh) return;
      if (!fresh.unified_summary_processing && fresh.unified_summary_document_id) {
        // Generation finished and the PDF is available — open it.
        setPendingDocumentSwitch(fresh.unified_summary_document_id);
      }
    };
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture.id, lecture.unified_summary_processing]);

  async function startGeneration(lecturerSummaryId: number | null) {
    setUploadError(null);
    setGenStarting(true);
    try {
      const res = await api.generateLectureUnifiedSummary(lecture.id, lecturerSummaryId);
      setActiveLecture(res.data);
    } catch (err: any) {
      setUploadError(err?.response?.data?.detail ?? 'Failed to start generation.');
    } finally {
      setGenStarting(false);
    }
  }

  function handleGenerateClick() {
    const summaries = lecture.lecturer_summaries ?? [];
    if (summaries.length === 0) {
      setUploadError('צריך לפחות סיכום מרצה אחד לפני יצירת הסיכום המאוחד.');
      return;
    }
    if (summaries.length === 1) {
      void startGeneration(summaries[0].id);
      return;
    }
    setPickerOpen(true);
  }

  async function handleUploadAndAttach(
    file: File,
    kind: 'lecturer' | 'student' | 'recording' | 'note',
  ) {
    setUploading(kind);
    setUploadError(null);
    try {
      // CAS-upload (or reuse existing UserDocument on 409 dedup).
      let userDocId: number;
      try {
        const upRes = await api.uploadDocument(file, false);
        userDocId = upRes.data.id;
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        const existing = err?.response?.status === 409 && typeof detail === 'object'
          ? detail?.existing_user_document_id : undefined;
        if (typeof existing === 'number') userDocId = existing;
        else throw err;
      }
      const title = file.name.replace(/\.(pdf|docx?|mp3|m4a|wav|ogg|aac|flac|webm|png|jpe?g|webp|heic)$/i, '');
      if (kind === 'lecturer') {
        const res = await api.createLectureLecturerSummary(lecture.id, {
          user_document_id: userDocId,
          title,
        });
        // Optimistic refresh + jump straight to the new doc in MainWorkspace.
        await refreshLecture();
        setPendingDocumentSwitch(res.data.user_document_id ?? userDocId);
      } else if (kind === 'student') {
        const res = await api.createLectureStudentSummary(lecture.id, {
          user_document_id: userDocId,
          title,
        });
        await refreshLecture();
        setPendingDocumentSwitch(res.data.user_document_id ?? userDocId);
      } else if (kind === 'recording') {
        await api.createLectureRecording(lecture.id, { user_document_id: userDocId, title });
        await refreshLecture();
      } else if (kind === 'note') {
        await api.createLectureNote(lecture.id, { user_document_id: userDocId, title });
        await refreshLecture();
      }
    } catch (err: any) {
      setUploadError(err?.response?.data?.detail ?? err?.message ?? 'Upload failed.');
    } finally {
      setUploading(null);
    }
  }

  const lecturerGroups = useMemo(() => {
    const groups = new Map<number | 'none', { name: string; items: any[] }>();
    for (const s of (lecture.lecturer_summaries ?? [])) {
      const key = s.lecturer_id ?? 'none';
      if (!groups.has(key)) groups.set(key, { name: s.lecturer_name ?? 'ללא מרצה', items: [] });
      groups.get(key)!.items.push(s);
    }
    return Array.from(groups.entries()).map(([k, v]) => ({ key: k, ...v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture.lecturer_summaries]);

  function switchToDoc(userDocId: number | null | undefined) {
    if (!userDocId) return;
    setInlineAudio(null);
    setInlineImage(null);
    setPendingDocumentSwitch(userDocId);
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-white p-3 gap-2 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-[#E8E8E6]">
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[#787774] hover:bg-[#F7F7F5]"
          title="Close lecture context"
          aria-label="Close lecture context"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] text-[#787774]">Lecture</p>
          <h3 className="text-sm font-semibold text-[#37352F] truncate" dir="auto">{lecture.title}</h3>
        </div>
      </div>

      {/* Inline previews (audio / image) */}
      {inlineAudio && (
        <div className="mt-1 p-2 bg-[#F7F7F5] rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#787774] truncate" dir="auto">{inlineAudio.title}</span>
            <button onClick={() => setInlineAudio(null)} className="text-[10px] text-[#787774] hover:text-red-600">סגור</button>
          </div>
          <audio controls src={inlineAudio.url} className="w-full" />
        </div>
      )}
      {inlineImage && (
        <div className="mt-1 p-2 bg-[#F7F7F5] rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#787774] truncate" dir="auto">{inlineImage.title}</span>
            <button onClick={() => setInlineImage(null)} className="text-[10px] text-[#787774] hover:text-red-600">סגור</button>
          </div>
          <img src={inlineImage.url} alt={inlineImage.title} className="w-full rounded-md border border-[#E8E8E6]" />
        </div>
      )}

      {/* Unified summary row */}
      <div className={[
        'flex items-center gap-1 rounded-lg',
        lecture.unified_summary_document_id === activeDocumentId
          ? 'bg-indigo-50 border border-indigo-200'
          : 'border border-transparent',
      ].join(' ')}>
        <button
          onClick={() => switchToDoc(lecture.unified_summary_document_id)}
          disabled={!lecture.unified_summary_document_id}
          className={[
            'flex-1 flex items-center gap-2 px-2 py-2 rounded-lg text-start',
            lecture.unified_summary_document_id === activeDocumentId
              ? 'text-indigo-700'
              : lecture.unified_summary_document_id
                ? 'text-[#37352F] hover:bg-[#F7F7F5]'
                : 'text-[#37352F] opacity-60 cursor-not-allowed',
          ].join(' ')}
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span className="flex-1 truncate text-sm font-medium">סיכום מאוחד</span>
          <span className="text-[10px] font-medium text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded shrink-0">AI</span>
          {!lecture.unified_summary_document_id && !lecture.unified_summary_processing && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#C4C4C4]" title="עוד לא יוצר" />
          )}
        </button>
        {/* F-036.2 — generate / regenerate button. Backend gates writes
            to course owners; non-owners get a 404 surfaced inline. */}
        <button
          onClick={handleGenerateClick}
          disabled={lecture.unified_summary_processing || genStarting}
          className="p-1.5 me-1 rounded text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title={lecture.unified_summary_document_id ? 'ייצר מחדש' : 'ייצר סיכום מאוחד'}
          aria-label="Generate unified summary"
        >
          {lecture.unified_summary_processing || genStarting
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : lecture.unified_summary_document_id
              ? <RefreshCw className="w-3.5 h-3.5" />
              : <Sparkles className="w-3.5 h-3.5" />}
        </button>
      </div>
      {lecture.unified_summary_processing && (
        <p className="text-[10px] text-[#787774] px-2 mt-0.5">
          מייצר סיכום מאוחד — לוקח 30–90 שניות, ייפתח אוטומטית כשיהיה מוכן.
        </p>
      )}
      {lecture.unified_summary_error && !lecture.unified_summary_processing && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-1">
          {lecture.unified_summary_error}
        </p>
      )}

      {uploadError && (
        <div className="mt-1 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700 flex items-start gap-1.5">
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="text-[#787774] hover:text-red-600 text-[10px]">close</button>
        </div>
      )}

      {/* Hidden file inputs that the section "+" buttons trigger */}
      <input
        ref={lecturerInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) void handleUploadAndAttach(f, 'lecturer');
        }}
      />
      <input
        ref={studentInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) void handleUploadAndAttach(f, 'student');
        }}
      />
      <input
        ref={recordingInputRef} type="file" accept=".mp3,.m4a,.wav,.webm,.ogg,.aac,.flac" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) void handleUploadAndAttach(f, 'recording');
        }}
      />
      <input
        ref={notesInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) void handleUploadAndAttach(f, 'note');
        }}
      />

      {/* Lecturer summaries */}
      <LectureSection
        label="סיכומי מרצה"
        count={lecture.lecturer_summaries?.length ?? 0}
        isOpen={open.lecturer}
        onToggle={() => setOpen(o => ({ ...o, lecturer: !o.lecturer }))}
        onAdd={() => lecturerInputRef.current?.click()}
        adding={uploading === 'lecturer'}
      >
        {lecturerGroups.length === 0 ? (
          <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימים סיכומי מרצה.</p>
        ) : lecturerGroups.map(g => (
          <div key={String(g.key)} className="mb-1">
            <p className="px-2 py-1 text-[11px] font-medium text-[#37352F]">{g.name} ({g.items.length})</p>
            {g.items.map((s: any) => (
              <LectureItem
                key={s.id}
                label={s.title}
                active={s.user_document_id === activeDocumentId}
                onClick={() => switchToDoc(s.user_document_id)}
                disabled={!s.user_document_id}
              />
            ))}
          </div>
        ))}
      </LectureSection>

      {/* Student summaries */}
      <LectureSection
        label="סיכומי תלמידים"
        count={lecture.student_summaries?.length ?? 0}
        isOpen={open.student}
        onToggle={() => setOpen(o => ({ ...o, student: !o.student }))}
        onAdd={() => studentInputRef.current?.click()}
        adding={uploading === 'student'}
      >
        {(lecture.student_summaries ?? []).length === 0 ? (
          <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימים סיכומי תלמידים.</p>
        ) : (lecture.student_summaries ?? []).map((s: any) => (
          <LectureItem
            key={s.id}
            label={s.title}
            active={s.user_document_id === activeDocumentId}
            onClick={() => switchToDoc(s.user_document_id)}
            disabled={!s.user_document_id}
          />
        ))}
      </LectureSection>

      {/* Recordings (audio — inline player) */}
      <LectureSection
        label="הקלטות"
        count={lecture.recordings?.length ?? 0}
        isOpen={open.recording}
        onToggle={() => setOpen(o => ({ ...o, recording: !o.recording }))}
        onAdd={() => recordingInputRef.current?.click()}
        adding={uploading === 'recording'}
      >
        {(lecture.recordings ?? []).length === 0 ? (
          <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימות הקלטות.</p>
        ) : (lecture.recordings ?? []).map((r: any) => {
          const url = lectureAttachmentUrl(r.file_path);
          return (
            <button
              key={r.id}
              onClick={() => {
                if (!url) return;
                setInlineImage(null);
                setInlineAudio({ id: r.id, title: r.title, url });
              }}
              disabled={!url}
              className={[
                'group w-full flex items-center gap-1.5 my-0.5 rounded-md text-start',
                inlineAudio?.id === r.id ? 'bg-indigo-50' : 'hover:bg-[#F7F7F5]',
                url ? '' : 'opacity-50 cursor-not-allowed',
              ].join(' ')}
            >
              <MicIcon className="w-3 h-3 text-[#787774] shrink-0 ms-2" />
              <span className={[
                'flex-1 truncate px-1 py-1.5 text-xs',
                inlineAudio?.id === r.id ? 'text-indigo-700 font-medium' : 'text-[#37352F]',
              ].join(' ')}>{r.title}</span>
            </button>
          );
        })}
      </LectureSection>

      {/* Notes (PDF → main pane swap; image → inline preview) */}
      <LectureSection
        label="הערות"
        count={lecture.notes?.length ?? 0}
        isOpen={open.note}
        onToggle={() => setOpen(o => ({ ...o, note: !o.note }))}
        onAdd={() => notesInputRef.current?.click()}
        adding={uploading === 'note'}
      >
        {(lecture.notes ?? []).length === 0 ? (
          <p className="text-xs text-[#C4C4C4] px-2 py-1">לא קיימות הערות.</p>
        ) : (lecture.notes ?? []).map((n: any) => {
          const isImage = n.doc_type === 'IMAGE';
          const url = lectureAttachmentUrl(n.file_path);
          return (
            <button
              key={n.id}
              onClick={() => {
                if (isImage) {
                  if (!url) return;
                  setInlineAudio(null);
                  setInlineImage({ id: n.id, title: n.title, url });
                } else {
                  switchToDoc(n.user_document_id);
                }
              }}
              disabled={!n.user_document_id && !url}
              className={[
                'group w-full flex items-center gap-1.5 my-0.5 rounded-md text-start',
                (isImage ? inlineImage?.id === n.id : n.user_document_id === activeDocumentId)
                  ? 'bg-indigo-50' : 'hover:bg-[#F7F7F5]',
              ].join(' ')}
            >
              {isImage
                ? <ImageIconLR className="w-3 h-3 text-[#787774] shrink-0 ms-2" />
                : <FileText className="w-3 h-3 text-[#787774] shrink-0 ms-2" />}
              <span className={[
                'flex-1 truncate px-1 py-1.5 text-xs',
                (isImage ? inlineImage?.id === n.id : n.user_document_id === activeDocumentId)
                  ? 'text-indigo-700 font-medium' : 'text-[#37352F]',
              ].join(' ')}>{n.title}</span>
            </button>
          );
        })}
      </LectureSection>

      {/* F-036.2 — pick which lecturer summary feeds the unified-summary skill */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPickerOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-5 border border-[#E8E8E6]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-[#37352F]">Pick a lecturer summary</h3>
              <button onClick={() => setPickerOpen(false)} className="p-1.5 text-[#787774] hover:bg-[#F7F7F5] rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#787774] mb-3">
              The chosen summary feeds the AI as the primary input. Others stay available in the accordion.
            </p>
            <ul className="space-y-1 max-h-[50vh] overflow-y-auto">
              {(lecture.lecturer_summaries ?? []).map((s: any) => (
                <li key={s.id}>
                  <button
                    onClick={async () => { setPickerOpen(false); await startGeneration(s.id); }}
                    className="w-full text-start px-3 py-2 rounded-lg border border-[#E8E8E6] hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <div className="text-sm font-medium text-[#37352F]" dir="auto">{s.title}</div>
                    {s.lecturer_name && (
                      <div className="text-[11px] text-[#787774] mt-0.5" dir="auto">{s.lecturer_name}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function LectureSection({
  label, count, isOpen, onToggle, children, onAdd, adding,
}: {
  label: string; count: number; isOpen: boolean; onToggle: () => void;
  children: React.ReactNode;
  onAdd?: () => void; adding?: boolean;
}) {
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-1.5 px-1.5 py-1.5 text-xs font-semibold text-[#37352F] hover:bg-[#F7F7F5] rounded"
        >
          {isOpen
            ? <ChevronDown className="w-3 h-3 rtl:rotate-180 shrink-0" />
            : <ChevronRight className="w-3 h-3 rtl:rotate-180 shrink-0" />}
          <span className="truncate flex-1 text-start">{label}</span>
          <span className="text-[#C4C4C4] font-normal">({count})</span>
        </button>
        {onAdd && (
          <button
            onClick={onAdd}
            disabled={Boolean(adding)}
            className="p-1 rounded text-[#787774] hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            title="Upload"
            aria-label="Upload"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      {isOpen && <div className="ps-2">{children}</div>}
    </div>
  );
}

function LectureItem({
  label, active, onClick, disabled,
}: {
  label: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full text-start px-2 py-1.5 text-xs my-0.5 rounded-md',
        active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-[#37352F] hover:bg-[#F7F7F5]',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <span className="truncate block" dir="auto">{label}</span>
    </button>
  );
}
