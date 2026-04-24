import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { Loader2, Sparkles, Plus, HelpCircle, Lightbulb, BookOpen, Code2, Wand2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { api } from '../../../services/api';

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

// ── Annotation types ─────────────────────────────────────────────────────────

type AnnotationType =
  | 'compilation_error'
  | 'runtime_error'
  | 'logic_error'
  | 'inefficient'
  | 'clean'
  | 'brilliant'
  | 'hint';

interface Annotation {
  type: AnnotationType;
  quote: string;
  feedback: string;
}

const TYPE_ICONS: Record<AnnotationType, string> = {
  compilation_error: '🛑',
  runtime_error:     '💥',
  logic_error:       '🐛',
  inefficient:       '⚠️',
  clean:             '✨',
  brilliant:         '💎',
  hint:              '💡',
};

function formatTypeTitle(t: AnnotationType): string {
  return t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Wraps English/code/math sequences in backticks so Monaco renders them as
 * inline-code inside the RTL Hebrew tooltip.  Already-wrapped spans are left
 * untouched via a stash-and-restore pass.
 *
 * Regex — two alternatives:
 *   alt-1 (complex expression):
 *     starts  → ASCII letter, digit, or _
 *     middle  → any mix of alphanumeric, _, ., operators (+ - * / ^ = < > ! & | % : , ),
 *               brackets [](){}, and spaces (needed for "len - 1", "O(n^2)")
 *     ends    → alphanumeric or a closing bracket ] ) }
 *     covers: "arr[i]", "arr.length - 1", "O(n^2)", "i < n", "x == 0"
 *   alt-2 (single token): bare alphanumeric run → "i", "n", "42"
 */
function formatBidiText(raw: string): string {
  // Pass 1 — stash already-wrapped backtick spans
  const stash: string[] = [];
  const s1 = raw.replace(/`[^`\n]+`/g, (m) => {
    stash.push(m);
    return `\x00${stash.length - 1}\x00`;
  });

  // Pass 2 — wrap code/math/English blocks
  const s2 = s1.replace(
    /([a-zA-Z0-9_][a-zA-Z0-9_.+\-*\/^=<>!&|%:,\[\](){}; ]*[a-zA-Z0-9_\])}]|[a-zA-Z0-9_]+)/g,
    (m) => `\`${m}\``,
  );

  // Pass 3 — restore stashed spans
  return s2.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CodeViewerProps {
  file: File | string;
  filename: string;
  documentId: number | null;
  handleQuickAction: (action: 'translate' | 'explain' | 'quiz' | 'chat') => void;
  handleSmartAction: (action: string) => void;
  isCreatingThread: boolean;
}

interface MenuPos { x: number; y: number }

// ── Component ────────────────────────────────────────────────────────────────

export default function CodeViewer({
  file,
  filename,
  documentId,
  handleQuickAction,
  handleSmartAction,
  isCreatingThread,
}: CodeViewerProps) {
  const setTextSelection = useAppStore(s => s.setTextSelection);

  const [code, setCode]               = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const [menuPos, setMenuPos]         = useState<MenuPos | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [showReviewLayer, setShowReviewLayer] = useState(false);

  const containerRef       = useRef<HTMLDivElement>(null);
  const editorRef          = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const menuRef            = useRef<HTMLDivElement>(null);
  const decorationsRef     = useRef<any>(null);
  const hoverDecRef        = useRef<any>(null);
  const annotationLinesRef = useRef<Map<number, AnnotationType>>(new Map());

  const language = getLanguage(filename);

  // ── 1. Load raw text content ─────────────────────────────────────────────

  useEffect(() => {
    if (!file) return;
    setIsLoading(true);
    setCode(null);
    setTextSelection(null);
    setMenuPos(null);
    setAnnotations(null);
    setShowReviewLayer(false);
    decorationsRef.current?.clear?.();
    decorationsRef.current = null;
    hoverDecRef.current?.clear?.();
    hoverDecRef.current = null;
    annotationLinesRef.current = new Map();

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

  // ── 2. Apply / clear decorations when review layer toggles ───────────────

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    annotationLinesRef.current = new Map();

    if (!showReviewLayer || !annotations?.length) {
      decorationsRef.current?.clear?.();
      hoverDecRef.current?.clear?.();
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const deltas: MonacoEditor.IModelDeltaDecoration[] = [];

    for (const ann of annotations) {
      if (!ann.quote) continue;

      // Try exact match first, then trimmed fallback (handles LLM whitespace drift)
      let matches = model.findMatches(ann.quote, false, false, true, null, false);
      if (!matches.length) {
        const trimmed = ann.quote.trim();
        if (trimmed) matches = model.findMatches(trimmed, false, false, true, null, false);
      }
      if (!matches.length) {
        console.warn('[CodeReview] No match for quote:', ann.quote.substring(0, 80));
        continue;
      }

      const range = matches[0].range;
      const icon  = TYPE_ICONS[ann.type];
      const title = formatTypeTitle(ann.type);

      annotationLinesRef.current.set(range.startLineNumber, ann.type);

      deltas.push({
        range,
        options: {
          linesDecorationsClassName: `review-bar--${ann.type}`,
          glyphMarginClassName:      `review-glyph review-glyph--${ann.type}`,
          hoverMessage: {
            // \u200F = Unicode Right-To-Left Mark — forces browser BiDi engine
            // to treat the run as RTL without relying on HTML (DOMPurify strips <div dir>)
            value: `\u200F**${icon} ${title}**\n\n\u200F${formatBidiText(ann.feedback)}`,
          },
          glyphMarginHoverMessage: { value: `${icon} ${ann.feedback}` },
        },
      });
    }

    if (decorationsRef.current) {
      decorationsRef.current.set(deltas);
    } else {
      decorationsRef.current = (editor as any).createDecorationsCollection(deltas);
    }
  }, [annotations, showReviewLayer, code]);

  // ── 2b. JS-driven hover highlight via onMouseMove ─────────────────────────

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !showReviewLayer || !annotations?.length) {
      hoverDecRef.current?.clear?.();
      return;
    }

    let currentHoverLine = -1;

    const moveDisposable = editor.onMouseMove((e) => {
      const lineNum = e.target.position?.lineNumber ?? -1;
      if (lineNum === currentHoverLine) return;
      currentHoverLine = lineNum;

      hoverDecRef.current?.clear?.();
      hoverDecRef.current = null;

      const type = annotationLinesRef.current.get(lineNum);
      if (type) {
        hoverDecRef.current = (editor as any).createDecorationsCollection([{
          range: { startLineNumber: lineNum, startColumn: 1, endLineNumber: lineNum, endColumn: 1 },
          options: { isWholeLine: true, className: `review-hover--${type}` },
        }]);
      }
    });

    const leaveDisposable = editor.onMouseLeave(() => {
      currentHoverLine = -1;
      hoverDecRef.current?.clear?.();
      hoverDecRef.current = null;
    });

    return () => {
      moveDisposable.dispose();
      leaveDisposable.dispose();
      hoverDecRef.current?.clear?.();
      hoverDecRef.current = null;
    };
  }, [annotations, showReviewLayer]);

  // ── 3. Monaco mount: wire selection events ───────────────────────────────

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

      const startPos = { lineNumber: sel.startLineNumber, column: sel.startColumn };
      const pixelPos = (editorInstance as any).getScrolledVisiblePosition?.(startPos) as
        | { top: number; left: number; height: number }
        | null | undefined;

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos(
          pixelPos != null
            ? { x: rect.left + pixelPos.left, y: rect.top + pixelPos.top }
            : { x: rect.left + rect.width / 2, y: rect.top + 56 },
        );
      }

      setTextSelection({ text: selectedText, x: 0, y: 0, width: 0, height: 0 });
    });
  }, [setTextSelection]);

  // ── 4. Dismiss menu when clicking outside it ─────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
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

  // ── 5. AI Code Review handler ────────────────────────────────────────────

  const handleReview = async () => {
    if (annotations) {
      setShowReviewLayer(prev => !prev);
      return;
    }
    if (!documentId) return;

    setIsReviewing(true);
    try {
      const res = await api.generateCodeReview(documentId);
      const data: Annotation[] = res.data?.annotations ?? [];
      setAnnotations(data);
      setShowReviewLayer(true);
    } catch (err) {
      console.error('[CodeViewer] Code review failed:', err);
    } finally {
      setIsReviewing(false);
    }
  };

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
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#E8E8E6] bg-[#F7F7F5] shrink-0">
        <Code2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="text-xs font-mono font-medium text-[#37352F] truncate">{filename}</span>

        <div className="ms-auto flex items-center gap-2">
          <span className="text-[10px] text-[#C4C4C4] capitalize tracking-wide">{language}</span>

          {documentId && (
            <button
              onClick={handleReview}
              disabled={isReviewing}
              title={annotations ? (showReviewLayer ? 'Hide annotations' : 'Show annotations') : 'Run AI Code Review'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors duration-150 border
                ${showReviewLayer && annotations
                  ? 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-700'
                  : 'bg-white text-[#787774] border-[#E8E8E6] hover:bg-[#F7F7F5] hover:text-[#37352F]'
                }
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isReviewing
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Wand2 className="w-3 h-3" />
              }
              {isReviewing ? 'Reviewing…' : annotations ? (showReviewLayer ? 'Hide Review' : 'Show Review') : 'AI Review'}
            </button>
          )}
        </div>
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
            glyphMargin:               true,
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
