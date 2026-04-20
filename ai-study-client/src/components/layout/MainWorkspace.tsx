import React, { useState, useRef, type Dispatch, type SetStateAction } from 'react';
import PdfViewer from '../../features/documents/components/PdfViewer';
import CodeViewer from '../../features/documents/components/CodeViewer';
import ChatPanel from '../../features/chat/components/ChatPanel';
import WorkspaceHeader from './WorkspaceHeader';
import type { Thread } from '../../types';
import { useAppStore } from '../../store/useAppStore';

// ── Prop shape helpers ─────────────────────────────────────────────────────

interface DocProps {
  file: any;
  documentId: number | null;
  documentTitle?: string;
  docType?: string;
  numPages: number;
  setNumPages: Dispatch<SetStateAction<number>>;
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
}

interface ChatProps {
  threads: Thread[];
  inputMessage: string;
  setInputMessage: (s: string) => void;
  isSending: boolean;
  isCreatingThread: boolean;
  pendingForkMsgId: number | null;
  treeViewMode: 'miller' | 'breadcrumbs' | 'graph';
  handleCreateThread: (prompt?: string) => void;
  handleQuickAction: (action: 'translate' | 'explain' | 'quiz' | 'chat') => void;
  handleSmartAction: (action: string) => void;
  handleForkMessage: (messageId: number) => void;
  handleSendMessage: () => void;
  /** Name of the active persona for this session (null = No Agent) */
  activePersonaName?: string | null;
  /** ID of the active persona for this session (null = No Agent) */
  activePersonaId?: string | null;
  /** Called when the user confirms a mid-session persona switch */
  onSwitchPersona?: (newId: string | null, keepContext: boolean) => void;
}

interface MainWorkspaceProps {
  doc: DocProps;
  chat: ChatProps;
  /** Opens the Session Wrap-Up modal (triggered by the header's Brain button). */
  onSaveMemory?: () => void;
}

/**
 * Layout component for the study workspace.
 *
 * Two modes:
 * - Normal: WorkspaceHeader + PDF viewer (left) + resizable divider + Chat panel (right)
 * - Standalone: WorkspaceHeader + Chat panel centered (no PDF, no divider)
 */
const MainWorkspace: React.FC<MainWorkspaceProps> = ({ doc, chat, onSaveMemory }) => {
  const { textSelection, setTextSelection, activeThread, setActiveThread } = useAppStore();

  // ── Local layout state ───────────────────────────────────────────────────
  const [scale, setScale]           = useState(1.0);
  const [chatWidth, setChatWidth]   = useState(33);
  const [isDragging, setIsDragging] = useState(false);
  const pdfContainerRef             = useRef<HTMLDivElement>(null);

  // ── Text selection: reads local scale, writes to Zustand ────────────────
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.toString().trim() === '') {
      setTextSelection(null);
      return;
    }

    const text  = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect  = range.getBoundingClientRect();

    let node        = range.commonAncestorContainer as Node | null;
    let pageElement: HTMLElement | null = null;
    while (node && node !== document.body) {
      if ((node as HTMLElement).classList?.contains('react-pdf__Page')) {
        pageElement = node as HTMLElement;
        break;
      }
      node = node.parentNode;
    }

    if (!pageElement) {
      setTextSelection(null);
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    setTextSelection({
      text,
      x:      (rect.left   - pageRect.left) / scale,
      y:      (rect.top    - pageRect.top)  / scale,
      width:  rect.width  / scale,
      height: rect.height / scale,
    });
  };

  // ── Drag-divider handlers ────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    // Dragging right (positive movementX) → divider moves right → chat gets narrower
    const delta = (e.movementX / window.innerWidth) * 100;
    setChatWidth(prev => {
      const next = prev - delta;
      return (next > 20 && next < 60) ? next : prev;
    });
  };

  const handleMouseUp = () => {
    if (isDragging) setIsDragging(false);
  };

  // ── Shared ChatPanel props ────────────────────────────────────────────────
  const chatPanelProps = {
    documentId:      doc.documentId,
    activeThread,
    threads:         chat.threads,
    setActiveThread,
    inputMessage:    chat.inputMessage,
    setInputMessage: chat.setInputMessage,
    handleSendMessage: chat.handleSendMessage,
    isSending:       chat.isSending,
    onForkMessage:   chat.handleForkMessage,
    pendingForkMsgId: chat.pendingForkMsgId,
    treeViewMode:    chat.treeViewMode,
    currentPage:     doc.currentPage,
    activePersonaName: chat.activePersonaName,
    activePersonaId:   chat.activePersonaId,
    onSwitchPersona:   chat.onSwitchPersona,
  };

  // ── Shared header ─────────────────────────────────────────────────────────
  const header = (
    <WorkspaceHeader
      documentTitle={doc.documentTitle ?? 'Document'}
      onExportSession={() => console.log('INTENT: export session', { documentId: doc.documentId })}
      onSaveMemory={onSaveMemory}
    />
  );

  // ── Standalone chat mode (no PDF) ─────────────────────────────────────────
  if (!doc.documentId) {
    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {header}
        <div className="flex flex-1 overflow-hidden items-start justify-center p-4">
          <div className="max-w-4xl mx-auto w-full h-full">
            <ChatPanel {...chatPanelProps} />
          </div>
        </div>
      </div>
    );
  }

  // ── Normal mode (PDF + Chat) ──────────────────────────────────────────────
  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {header}

      <div
        className="flex flex-1 overflow-hidden relative"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Capture-layer while dragging prevents iframe/PDF from stealing events */}
        {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}

        {/* Viewer pane */}
        <div className="flex-1 h-full flex flex-col overflow-hidden ms-1">
          {doc.docType === 'SOURCE_CODE' ? (
            <CodeViewer
              file={doc.file}
              filename={doc.documentTitle ?? 'file'}
              handleQuickAction={chat.handleQuickAction}
              handleSmartAction={chat.handleSmartAction}
              isCreatingThread={chat.isCreatingThread}
            />
          ) : (
            <PdfViewer
              file={doc.file}
              numPages={doc.numPages}
              onDocumentLoadSuccess={({ numPages }) => doc.setNumPages(numPages)}
              threads={chat.threads}
              activeThread={activeThread}
              setActiveThread={setActiveThread}
              textSelection={textSelection}
              handleQuickAction={chat.handleQuickAction}
              handleSmartAction={chat.handleSmartAction}
              isCreatingThread={chat.isCreatingThread}
              pdfContainerRef={pdfContainerRef}
              handleTextSelection={handleTextSelection}
              currentPage={doc.currentPage}
              setCurrentPage={doc.setCurrentPage}
              scale={scale}
              setScale={setScale}
            />
          )}
        </div>

        {/* Resizable divider */}
        <div
          className={`w-1 cursor-col-resize transition-colors duration-150 z-20 flex-shrink-0 mx-2 rounded-full ${
            isDragging ? 'bg-indigo-400' : 'bg-[#E8E8E6] hover:bg-[#C4C4C4]'
          }`}
          onMouseDown={e => { e.preventDefault(); setIsDragging(true); }}
          title="Drag to resize"
        />

        {/* Chat pane */}
        <div style={{ width: `${chatWidth}%` }} className="flex-shrink-0 overflow-hidden">
          <ChatPanel {...chatPanelProps} />
        </div>
      </div>
    </div>
  );
};

export default MainWorkspace;
