import React, { useState } from 'react';
import { Send, Bot, User as UserIcon, MessageSquare, GitBranch, Network, FileText, Sparkles, Loader2, Wand2, BookOpen, Settings2, AlignLeft, Zap } from 'lucide-react';
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
}) => {
  const [activeTab, setActiveTab] = useState<'tree' | 'chat' | 'summary'>('tree');
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
  const renderMessage = (
    msg: Message,
    allThreads: Thread[],
    currentThread: Thread,
    setThread: Function,
    forkHandler: Function,
    pendingId: number | null,
  ) => (
    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        msg.role === 'user'
          ? 'bg-[#EFEFED] text-[#787774]'
          : 'bg-indigo-50 text-indigo-600'
      }`}>
        {msg.role === 'user' ? <UserIcon size={14} /> : <Bot size={14} />}
      </div>

      <div className="flex flex-col gap-1.5 max-w-[85%]">
        {/* Bubble */}
        <div className={`p-3 text-sm leading-relaxed ${
          msg.role === 'user'
            ? 'bg-[#F7F7F5] text-[#37352F] border border-[#E8E8E6] rounded-xl rounded-tr-none whitespace-pre-wrap'
            : 'bg-white border border-[#E8E8E6] text-[#37352F] rounded-xl rounded-tl-none prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0'
        }`}>
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={{
              p:     ({ node, ...props }) => <p dir="auto" {...props} />,
              li:    ({ node, ...props }) => <li dir="auto" {...props} />,
              table: ({ node, ...props }) => (
                <div className="overflow-x-auto my-4">
                  <table className="border-collapse border border-[#E8E8E6] w-full rounded-lg" {...props} />
                </div>
              ),
              th: ({ node, ...props }) => (
                <th dir="auto" className="border border-[#E8E8E6] bg-[#F7F7F5] p-2 font-semibold text-[#37352F] text-start" {...props} />
              ),
              td: ({ node, ...props }) => (
                <td dir="auto" className="border border-[#E8E8E6] p-2 text-[#787774] text-start" {...props} />
              ),
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>

        {/* Fork button — AI messages only */}
        {msg.role === 'assistant' && (
          <div className="flex justify-start ms-1">
            {(() => {
              const isForkActiveInDB = currentThread.forked_from_message_id === msg.id;
              const isPendingFork    = pendingId === msg.id;

              let btnClass = 'text-[#787774] border border-[#E8E8E6] hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50';
              let btnText  = 'Fork thread';
              let btnTitle = 'Start a new branch from this message';
              let onClickHandler = () => forkHandler(msg.id);

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
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 ${btnClass}`}
                  title={btnTitle}
                >
                  <GitBranch size={12} />
                  {btnText}
                </button>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );

  // ── Tab helpers ────────────────────────────────────────────────────────────
  const tabBase = 'flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium border-b-2 transition-colors duration-150';
  const tabActive = 'border-indigo-600 text-indigo-600 bg-white';
  const tabInactive = 'border-transparent text-[#787774] hover:bg-[#EFEFED]';

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="w-full bg-white border border-[#E8E8E6] rounded-xl flex flex-col overflow-hidden h-full max-h-full">

      {/* ── Active persona bar ────────────────────────────────────────── */}
      {activePersonaName !== undefined && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#F7F7F5] border-b border-[#E8E8E6] shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-[#787774]">
            <Wand2 className="w-3 h-3 text-indigo-500" />
            <span className="font-medium text-[#37352F]">
              {activePersonaName ?? 'No Agent'}
            </span>
          </span>
          <button
            onClick={() => setIsSwitchModalOpen(true)}
            className="text-[10px] font-medium text-[#787774] hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-colors duration-150"
          >
            Change
          </button>
        </div>
      )}

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

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex bg-[#F7F7F5] border-b border-[#E8E8E6] shrink-0">
        {documentId !== null && (
          <button
            onClick={() => setActiveTab('tree')}
            className={`${tabBase} ${activeTab === 'tree' ? tabActive : tabInactive}`}
          >
            <Network className="w-3.5 h-3.5" /> Threads
          </button>
        )}
        <button
          onClick={() => setActiveTab('chat')}
          className={`${tabBase} ${activeTab === 'chat' ? tabActive : tabInactive}`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Active Chat
        </button>
        {documentId !== null && (
          <button
            onClick={() => setActiveTab('summary')}
            className={`${tabBase} ${activeTab === 'summary' ? tabActive : tabInactive}`}
          >
            <FileText className="w-3.5 h-3.5" /> Summary
          </button>
        )}
      </div>

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
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">

            {activeThread && (
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

          {/* Model picker — provider + tier, right above the input */}
          <div className="px-4 pt-2 pb-1 bg-white border-t border-[#E8E8E6] flex items-center gap-2 flex-wrap text-xs">
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

          {/* Input bar */}
          <div className="px-4 py-3 bg-white border-t border-[#E8E8E6] flex gap-2 shrink-0">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Continue the conversation…"
              dir="auto"
              className="flex-1 border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm text-[#37352F] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-colors duration-150"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isSending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
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
