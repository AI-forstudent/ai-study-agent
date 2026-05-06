# Frontend — Local Directives

> Read `../CLAUDE.md` first. This file adds frontend-specific rules.

## Stack quick reference

- **React 19** + **TypeScript** + **Vite 7**
- **TailwindCSS 3.4** — utility-first, no custom CSS files except `index.css`
- **Zustand 5** for global state (`src/store/useAppStore.ts`)
- **Axios** with auth interceptor (`src/services/api.ts`)
- **react-pdf** for PDF rendering, **Monaco** for code, **react-markdown + remark-math + rehype-katex** for AI output
- **`lucide-react`** for icons — never import other icon packs
- **No CSS-in-JS, no styled-components** — Tailwind only

## Directory structure (DDD by feature)

- `src/features/<feature>/components/` — feature-scoped components
- `src/features/<feature>/hooks/` — feature-scoped hooks
- `src/components/layout/` — global layout (Sidebar, MainWorkspace, Settings, etc.)
- `src/components/ui/` — generic primitives (modals, buttons) shared across features
- `src/hooks/` — global hooks (`useAuth`, `useChat`, `useDocuments`)
- `src/store/useAppStore.ts` — single Zustand store, sliced internally by domain
- `src/services/api.ts` — single axios instance, all API calls route through here
- `src/data/mocks/` — typed mock data mirroring API response shapes (used in dev + tests)
- `src/types/` — shared TS types

## Conventions

- **camelCase everywhere** — variables, functions, props, file names for non-component files.
- **PascalCase for component files** — `ChatPanel.tsx`, `PersonaEditor.tsx`.
- **One component per file** unless tightly coupled (e.g., a small `<EmptyState />` used only inside one parent).
- **Types live next to usage** for feature-internal types, in `src/types/` only when shared across features.
- **API base URL** comes from `VITE_AI_API_URL` env var — never hardcode.
- **Auth token:** stored in Zustand + localStorage, attached automatically by the axios interceptor. Never manually add `Authorization` headers in components.
- **No fetch() calls directly** — always go through `services/api.ts`.

## Persona prompt editor

The persona prompt is parsed visually by section headers — keep them as `## ROLE`, `## TONE`, `## STYLE`, `## LANGUAGE`. Do not change the header format without updating both `PersonaEditor.tsx` and the backend prompt builder.

## Testing

- Tests live in `src/tests/`.
- Use the existing test patterns in `src/tests/api.test.ts`.
- For new components with complex logic, add a test alongside.

## Common gotchas

- **React 19 strict mode** — effects run twice in dev. Make sure cleanup is correct.
- **Vite env vars** must be prefixed `VITE_` to be exposed to the client.
- **`react-pdf` worker** — `pdfjs-dist` worker URL must match the installed version exactly. If you upgrade `pdfjs-dist`, also update the worker reference in `PdfViewer.tsx`.
- **Tailwind `@tailwindcss/typography`** — for AI markdown output, wrap in `prose prose-sm` so KaTeX + code blocks render correctly.
- **Zustand selectors** — always use selector functions (`useAppStore(s => s.threads)`) to avoid re-rendering the entire app on any store change.
