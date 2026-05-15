# AI Study Partner — Frontend

React 19 + TypeScript + Vite client for the AI Study Partner platform. For the project-wide overview see the [root README](../README.md); for architecture see [`SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md) §6 (Frontend File Index). For coding conventions read [`CLAUDE.md`](CLAUDE.md).

## Stack

- **React 19** + **TypeScript** + **Vite 7**
- **TailwindCSS 3.4** + `@tailwindcss/typography` — Tailwind only, no CSS-in-JS
- **Zustand 5** — single global store at [`src/store/useAppStore.ts`](src/store/useAppStore.ts)
- **Axios** with JWT interceptor — single client at [`src/services/api.ts`](src/services/api.ts); never `fetch()` directly
- **`react-pdf`** for PDF rendering, **`@monaco-editor/react`** for code, **`react-markdown` + `remark-math` + `rehype-katex` + `remark-gfm`** for AI output
- **`lucide-react`** for icons — no other icon packs

## Quick Start

```bash
npm install
echo 'VITE_AI_API_URL=http://localhost:8001' > .env.local
npm run dev
```

Open <http://localhost:5173>. The backend must be running on the URL set in `VITE_AI_API_URL` (default in local dev: `http://localhost:8001`; in production: the domain root, with Nginx routing `/api/*` to `backend:8001`).

### Optional env vars

| Var | Purpose |
|---|---|
| `VITE_AI_API_URL` | API base URL — **required**. Local dev: `http://localhost:8001`. Prod: `https://<your-domain>`. |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Enables Google Sign-In button in `AuthModal`. Omit to hide it. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 5173) with HMR |
| `npm run build` | Type-check (`tsc -b`) then production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | ESLint over `**/*.{ts,tsx}` |

## Directory Layout (Domain-Driven Design)

```
src/
├── App.tsx                       # Root component — wires hooks together, owns session lifecycle
├── main.tsx                      # Vite entry
├── index.css                     # Tailwind directives + iOS-zoom guard
│
├── store/useAppStore.ts          # Single Zustand store
├── services/api.ts               # Axios client with auth interceptor
│
├── hooks/                        # Global hooks
│   ├── useAuth.ts                # Auth state + view switching
│   ├── useChat.ts                # Threads, messages, send/fork
│   ├── useDocuments.ts           # Uploads, library, viewer doc state
│   ├── useFolders.ts             # Folder CRUD + optimistic star
│   └── useBreakpoint.ts          # phone / tablet / desktop matchMedia
│
├── features/                     # Feature-scoped components (DDD)
│   ├── personas/components/      # PersonaLab, PersonaEditor, PreviewPanel
│   ├── chat/components/          # ChatPanel + thread-tree strategies
│   ├── documents/components/     # PdfViewer, CodeViewer, FileUploadView, DocCard
│   ├── sessions/components/      # PreFlightModal, SessionWrapUpModal, ResumeToast
│   ├── courses/components/       # CourseDetailView, CourseLecturesTab, LectureSessionView, ExamDetailView
│   └── PersonalHub/              # Personal Hub dashboard + sub-views
│
├── components/
│   ├── layout/                   # AppLayout, Sidebar, MainWorkspace, MyLibrary, PageContainer, Settings, LandingPage, WorkspaceHeader
│   └── ui/                       # AuthModal, ConfirmModal, FolderModal, MoveToFolderModal
│
├── data/mocks/                   # Typed mock data mirroring API response shapes
├── types/                        # Shared TS types
├── utils/                        # fileIcons, formatters
└── tests/                        # Vitest test files
```

## Conventions

- **camelCase** for variables, functions, props, and non-component file names.
- **PascalCase** for component files (`ChatPanel.tsx`).
- **API base URL** comes from `VITE_AI_API_URL` — never hardcode hosts.
- **All HTTP calls** go through `src/services/api.ts`. The interceptor attaches `Authorization: Bearer <token>`; components must not set the header manually.
- **Zustand selectors** — `useAppStore(s => s.threads)`, never `useAppStore()` (would re-render on any change).
- **Persona prompts** use these section headers and only these: `## ROLE`, `## TONE`, `## STYLE`, `## LANGUAGE`. The editor parses them visually and the backend prompt builder matches them.

See [`CLAUDE.md`](CLAUDE.md) for the full list of gotchas (React 19 strict mode, `react-pdf` worker version pinning, KaTeX prose wrapper, etc.).

## Testing

Tests live in [`src/tests/`](src/tests/). Use the patterns in `src/tests/api.test.ts`. Add a test alongside any new component with non-trivial logic.

```bash
npm test
```

## Production Build

The container at `Dockerfile.frontend` runs `npm run build` and serves `dist/` via Nginx (config in [`nginx.conf`](nginx.conf)). `VITE_AI_API_URL` is baked in at build time, so it must be set as a build arg in the compose file — see `docker-compose.prod.yml`.
