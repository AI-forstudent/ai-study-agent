import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { Loader2, Sparkles, Plus, HelpCircle, Lightbulb, BookOpen, Code2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

// ── Extension → Monaco language identifier ──────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  '.py':   'python',
  '.js':   'javascript',
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.jsx':  'javascript',
  '.html': 'html',
  '.css':  'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml':  'yaml',
  '.toml': 'ini',
  '.cpp':  'cpp',
  '.c':    'c',
  '.h':    'cpp',
  '.hpp':  'cpp',
  '.java': 'java',
  '.kt':   'kotlin',
  '.go':   'go',
  '.rs':   'rust',
  '.sh':   'shell',
  '.sql':  'sql',
  '.md':   'markdown',
};

function getLanguage(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return 'plaintext';
  return LANGUAGE_MAP[filename.substring(dot).toLowerCase()] ?? 'plaintext';
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CodeViewerProps {
  file: File | string;    // File object (fresh upload) or blob URL (library load)
  filename: string;       // original filename — drives language detection
  handleQuickAction: (action: 'translate' | 'explain' | 'quiz' | 'chat') => void;
  handleSmartAction: (action: string) => void;
  isCreatingThread: boolean;
}

interface MenuPos { x: number; y: number }

// ── Component ────────────────────────────────────────────────────────────────

export default function CodeViewer({
  file,
  filename,
  handleQuickAction,
  handleSmartAction,
  isCreatingThread,
}: CodeViewerProps) {
  const setTextSelection = useAppStore(s => s.setTextSelection);

  const [code, setCode]         = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [menuPos, setMenuPos]   = useState<MenuPos | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef    = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const menuRef      = useRef<HTMLDivElement>(null);

  const language = getLanguage(filename);

  // ── 1. Load raw text content ─────────────────────────────────────────────

  useEffect(() => {
    if (!file) return;
    setIsLoading(true);
    setCode(null);
    setTextSelection(null);
    setMenuPos(null);

    (async () => {
      try {
        const text = typeof file === 'string'
          ? await fetch(file).then(r => r.text())
          : await (file as File).text();
        setCode(text);
      } catch (err) {
        console.error('[CodeViewer] Failed to load file:', err);
        setCode('// Failed to load file content.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [file, setTextSelection]);

  // ── 2. Monaco mount: wire selection events ───────────────────────────────

  const handleEditorMount: OnMount = useCallback((editorInstance) => {
    editorRef.current = editorInstance;

    editorInstance.onDidChangeCursorSelection(() => {
      const model = editorInstance.getModel();
      const sel   = editorInstance.getSelection();
      if (!model || !sel) return;

      const selectedText = model.getValueInRange(sel).trim();
      if (!selectedText) {
        setTextSelection(null);
        setMenuPos(null);
        return;
      }

      // Pixel position of selection start, relative to editor container
      const startPos = { lineNumber: sel.startLineNumber, column: sel.startColumn };
      const pixelPos = (editorInstance as any).getScrolledVisiblePosition?.(startPos) as
        | { top: number; left: number; height: number }
        | null | undefined;

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos(
          pixelPos != null
            ? { x: rect.left + pixelPos.left, y: rect.top + pixelPos.top }
            : { x: rect.left + rect.width / 2, y: rect.top + 56 },  // fallback
        );
      }

      // Push selected text to Zustand so ChatPanel / thread creation has context
      setTextSelection({ text: selectedText, x: 0, y: 0, width: 0, height: 0 });
    });
  }, [setTextSelection]);

  // ── 3. Dismiss menu when clicking outside it ─────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return; // click on menu itself
      // Defer to let Monaco update its selection first
      setTimeout(() => {
        const sel = editorRef.current?.getSelection();
        if (!sel || sel.isEmpty()) {
          setTextSelection(null);
          setMenuPos(null);
        }
      }, 80);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setTextSelection]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 h-full flex items-center justify-center bg-[#EFEFED] rounded-xl border border-[#E8E8E6]">
        <div className="flex flex-col items-center gap-3 text-[#787774]">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Loading {filename}…</span>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="flex-1 h-full flex flex-col overflow-hidden rounded-xl border border-[#E8E8E6] bg-white relative"
    >
      {/* ── Filename header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#E8E8E6] bg-[#F7F7F5] shrink-0">
        <Code2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="text-xs font-mono font-medium text-[#37352F] truncate">{filename}</span>
        <span className="ms-auto text-[10px] text-[#C4C4C4] capitalize tracking-wide">{language}</span>
      </div>

      {/* ── Monaco Editor ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <Editor
          value={code ?? ''}
          language={language}
          theme="vs"
          onMount={handleEditorMount}
          options={{
            readOnly:                  true,
            minimap:                   { enabled: false },
            wordWrap:                  'on',
            fontSize:                  13,
            lineHeight:                22,
            fontFamily:                "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
            fontLigatures:             true,
            scrollBeyondLastLine:      false,
            renderLineHighlight:       'line',
            selectionHighlight:        true,
            occurrencesHighlight:      'off',
            renderWhitespace:          'selection',
            bracketPairColorization:   { enabled: true },
            guides:                    { bracketPairs: true },
            padding:                   { top: 12, bottom: 12 },
            scrollbar:                 { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          }}
          loading={
            <div className="flex items-center justify-center h-full bg-white">
              <Loader2 className="w-5 h-5 animate-spin text-[#787774]" />
            </div>
          }
        />
      </div>

      {/* ── Floating action menu (fixed overlay near selection) ──────────── */}
      {menuPos && (
        <div
          ref={menuRef}
          className="fixed z-[200] flex flex-col gap-1.5 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 drop-shadow-xl pointer-events-auto"
          style={{
            left:      menuPos.x,
            top:       menuPos.y - 92,
            transform: 'translateX(-50%)',
          }}
        >
          {/* Code-specific smart actions */}
          <div className="bg-indigo-700/90 backdrop-blur-md text-white rounded-lg shadow-lg flex items-center overflow-hidden border border-indigo-500/50 text-xs font-medium min-w-max">
            <div className="bg-indigo-800/80 px-2 py-2 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
            </div>
            <button
              onClick={() => handleSmartAction('explain-code')}
              className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5"
            >
              <BookOpen className="w-3.5 h-3.5" /> Explain
            </button>
            <div className="w-px h-4 bg-indigo-500/50" />
            <button
              onClick={() => handleSmartAction('find-bugs')}
              className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5" /> Find bugs
            </button>
            <div className="w-px h-4 bg-indigo-500/50" />
            <button
              onClick={() => handleSmartAction('refactor')}
              className="px-3 py-2 hover:bg-indigo-600/80 transition-colors flex items-center gap-1.5"
            >
              <Lightbulb className="w-3.5 h-3.5" /> Refactor
            </button>
          </div>

          {/* Quick actions row */}
          <div className="bg-slate-800/90 backdrop-blur-md text-white rounded-lg shadow-lg flex items-center overflow-hidden border border-slate-700/50 text-xs font-medium min-w-max">
            <button
              onClick={() => handleQuickAction('explain')}
              disabled={isCreatingThread}
              className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="text-sm leading-none">💡</span> Explain
            </button>
            <div className="w-px h-4 bg-slate-600/80" />
            <button
              onClick={() => handleQuickAction('quiz')}
              disabled={isCreatingThread}
              className="px-3 py-2 hover:bg-slate-700/80 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="text-sm leading-none">❓</span> Quiz me
            </button>
            <button
              onClick={() => handleQuickAction('chat')}
              disabled={isCreatingThread}
              className="px-3 py-2 bg-indigo-600/90 hover:bg-indigo-500/90 transition-colors flex items-center gap-1.5 border-s border-indigo-500/50 disabled:opacity-50"
            >
              {isCreatingThread
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Plus className="w-3.5 h-3.5" />
              }
              Chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
