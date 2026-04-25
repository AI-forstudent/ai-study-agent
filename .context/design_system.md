# Design System — Notion-Inspired Constitution

This file is the single source of truth for all UI decisions in this project.

**Enforcement rule:** When modifying any UI component, if the change violates these rules, refactor the violation immediately — do not defer it.

---

## Philosophy

Inspired by Notion's interface: flat, typographic, and content-first.
- White space does the heavy lifting — not shadows, gradients, or decorations.
- Color is used sparingly and always semantically.
- The interface should feel like it disappears — the user's content is the hero.
- UIs are invisible until interacted with.

---

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `notion-bg` | `#FFFFFF` | Main page/card backgrounds |
| `notion-bg_secondary` | `#F7F7F5` | Sidebars, hover states, secondary surfaces |
| `notion-bg_hover` | `#EFEFED` | Active hover on secondary surfaces |
| `notion-text` | `#37352F` | All primary body text and headings |
| `notion-text_secondary` | `#787774` | Labels, placeholders, metadata, muted text |
| `notion-text_tertiary` | `#C4C4C4` | Disabled states, very light hints |
| `notion-border` | `#E8E8E6` | All dividers, card borders, input borders |
| `indigo-600` | `#4F46E5` | AI actions only — generates/creates/summarizes |
| `red-500` | `#EF4444` | Destructive — delete, error states |
| `emerald-500` | `#10B981` | Success — confirmations, public badge |
| `amber-500` | `#F59E0B` | Warning — cost alerts, cautions |

### Rules
- `blue-600` is BANNED. All primary interactive actions use `indigo-600`.
- Gradients (`from-indigo-600 to-violet-600`) are allowed ONLY on: Landing Page hero CTA, Persona Lab synthesis button. Nowhere else in the app UI.
- Background colors: only `#FFFFFF`, `#F7F7F5`, or `#EFEFED`. `slate-100`/`slate-200` as surfaces are banned.
- `text-slate-*` for body text is banned. Use `text-[#37352F]` and `text-[#787774]`.

---

## Typography

| Use | Class |
|-----|-------|
| Page title | `text-2xl font-semibold text-[#37352F]` |
| Section heading | `text-base font-semibold text-[#37352F]` |
| Body text | `text-sm text-[#37352F]` |
| Muted / meta | `text-xs text-[#787774]` |
| Label above input | `text-xs font-medium text-[#787774] uppercase tracking-wide` |
| Code / ID preview | `font-mono text-xs text-[#787774] bg-[#F7F7F5] px-1.5 py-0.5 rounded` |

**Font:** Inter. Configured as default `font-sans` in `tailwind.config.js`, imported via `index.css`.
**Anti-aliasing:** `-webkit-font-smoothing: antialiased` applied globally.

---

## Spacing

- Card padding: `p-4` (compact) or `p-6` (standard). Minimum `p-4`.
- Element gaps: `gap-3` or `gap-4`. Between sections: `gap-6`.
- Page padding: `px-6 py-5` for top-level containers.
- Max content width: `max-w-6xl mx-auto` for gallery/feed pages.
- Modal max width: `max-w-md` (auth), `max-w-xl` (confirmations).

---

## Shadows & Elevation

| Level | Class | When |
|-------|-------|------|
| 0 — Flat | (none) | Default cards on white — border only |
| 1 — Raised | `shadow-sm` | Cards on `#F7F7F5` background, floating pills |
| 2 — Floating | `shadow-lg border border-[#E8E8E6]` | Dropdowns, popovers |
| 3 — Modal | `shadow-xl border border-[#E8E8E6]` | Modal cards, slide-over panels |

**Banned:** `shadow-md`, `shadow-2xl`, `shadow-indigo-*`, any colored shadow in app UI.

---

## Border Radius

| Element | Class |
|---------|-------|
| Inputs, small buttons | `rounded-md` |
| Standard buttons, tags | `rounded-lg` |
| Cards, panels | `rounded-xl` |
| Modals, large cards | `rounded-2xl` |
| Avatar / icon containers | `rounded-lg` or `rounded-full` |

`rounded-3xl` is banned in app UI.

---

## Buttons

### Primary (AI / confirm action)
```
bg-indigo-600 hover:bg-indigo-700 text-white
text-sm font-medium rounded-lg px-4 py-2.5
transition-colors duration-150
```

### Secondary
```
bg-[#F7F7F5] hover:bg-[#EFEFED] text-[#37352F]
text-sm font-medium rounded-lg px-4 py-2.5
border border-[#E8E8E6] transition-colors duration-150
```

### Ghost (icon buttons, navigation)
```
text-[#787774] hover:text-[#37352F] hover:bg-[#F7F7F5]
p-1.5 rounded-md transition-colors duration-150
```

### Destructive
```
bg-red-500 hover:bg-red-600 text-white
text-sm font-medium rounded-lg px-4 py-2.5
transition-colors duration-150
```

**Rules:**
- No `font-bold` on buttons — `font-medium` or `font-semibold` only.
- No `shadow-*` on buttons in app UI.
- Disabled state: `opacity-50 cursor-not-allowed`.
- No `hover:-translate-y-*` in app UI (landing page hero CTA only exception).

---

## Form Inputs

```
w-full bg-white border border-[#E8E8E6] rounded-lg
px-3 py-2.5 text-sm text-[#37352F]
placeholder:text-[#C4C4C4]
focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400
transition-colors duration-150
```

- Labels always above the input, never floating inside.
- Error state: `border-red-400 focus:ring-red-400/20 focus:border-red-400`.

---

## Icons

- Library: `lucide-react` exclusively.
- Standard size: `w-4 h-4`.
- Emphasis size: `w-5 h-5` (headings, empty states, CTAs).
- Decorative color: `text-[#787774]`
- Interactive color: `text-[#37352F]` or the semantic color.
- Max size in body content: `w-5 h-5`.

---

## Modals & Overlays

- Backdrop: `fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4`
- Card: `bg-white rounded-2xl shadow-xl border border-[#E8E8E6] w-full max-w-md`
- Close button: top-right corner, ghost style (`X` icon `w-4 h-4`)
- Escape key: always wired via `useEffect`
- Backdrop click: always closes (stopPropagation on card)

---

## Header Bar

```
bg-white border-b border-[#E8E8E6]   ← flat, no shadow
py-3 px-5
```

Logo: small icon + `font-semibold text-[#37352F]`. Nav items: ghost button style.

---

## Notion Patterns (Copy-Paste Ready)

### OR divider
```tsx
<div className="flex items-center gap-3">
  <div className="flex-1 border-t border-[#E8E8E6]" />
  <span className="text-xs font-medium text-[#787774]">OR</span>
  <div className="flex-1 border-t border-[#E8E8E6]" />
</div>
```

### Empty state
```tsx
<div className="flex flex-col items-center gap-2 py-16 text-[#787774]">
  <Icon className="w-8 h-8 opacity-40" />
  <p className="text-sm">Descriptive message here.</p>
</div>
```

### Badge / tag
```tsx
<span className="inline-flex items-center gap-1 text-xs font-medium
  px-2 py-0.5 rounded-md bg-[#F7F7F5] text-[#787774] border border-[#E8E8E6]">
  Label
</span>
```

### Error banner
```tsx
<div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-100
  rounded-lg text-sm text-red-700">
  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
  {message}
</div>
```

### Section divider
```tsx
<div className="border-t border-[#E8E8E6]" />
```

---

## Banned Patterns

| Pattern | Reason |
|---------|--------|
| `bg-blue-600` anywhere | Replaced globally by `indigo-600` |
| `shadow-md` / `shadow-2xl` in app UI | Too heavy |
| Colored shadows (`shadow-indigo-*`) in app UI | Marketing only |
| `bg-slate-100` / `bg-slate-200` as surfaces | Use `#F7F7F5` / `#EFEFED` |
| `text-slate-*` for body text | Use `#37352F` / `#787774` |
| `font-bold` on buttons | Use `font-medium` or `font-semibold` |
| `rounded-3xl` in app UI | Max is `rounded-2xl` |
| Gradients except approved locations | Landing hero + Persona Lab CTA only |
| `hover:-translate-y-*` in app UI | Landing page hero CTA only |
