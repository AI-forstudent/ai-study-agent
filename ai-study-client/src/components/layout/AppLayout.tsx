import { useEffect, useState, cloneElement, isValidElement, type ReactElement } from 'react';
import { Menu, X, Sparkles, ChevronLeft } from 'lucide-react';
import ToastContainer from '../ui/ToastContainer';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useAppStore } from '../../store/useAppStore';

interface AppLayoutProps {
  /** Sidebar component. On phone/tablet renders inside a slide-in drawer
   *  and is passed an extra `onClose` prop so nav clicks dismiss the drawer.
   *  On desktop the sidebar is ALWAYS collapsible — open by default on the
   *  main screen, closed by default inside any session (F-034). */
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function AppLayout({ sidebar, children }: AppLayoutProps) {
  const { isMobile } = useBreakpoint();
  const inSession = useAppStore(s => s.inSession);

  // ── Mobile drawer ───────────────────────────────────────────────────────
  // Stays a slide-in overlay drawer — unchanged from F-030.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Desktop sidebar (F-034) ─────────────────────────────────────────────
  // Always inline-push, always collapsible. The user can toggle anytime;
  // when `inSession` flips, we reset to its sensible default (open on
  // main, closed in session) so the user doesn't have to manually
  // re-collapse on entering a session.
  const [desktopOpen, setDesktopOpen] = useState(!inSession);
  useEffect(() => { setDesktopOpen(!inSession); }, [inSession]);

  // Close mobile drawer on viewport switch back to desktop, or on Escape.
  useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false);
  }, [isMobile, drawerOpen]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Lock background scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  // Inject onClose into the sidebar element when rendering it inside the
  // mobile drawer so nav clicks dismiss the drawer automatically.
  const sidebarWithClose = isValidElement(sidebar)
    ? cloneElement(sidebar as ReactElement<any>, { onCloseDrawer: () => setDrawerOpen(false) })
    : sidebar;

  // F-035: collapsed desktop sidebar renders an iconified rail (same nav
  // items as the expanded sidebar, just narrow). The Sidebar component
  // handles both modes via its `collapsed` prop.
  const sidebarExpanded = isValidElement(sidebar)
    ? cloneElement(sidebar as ReactElement<any>, {
        collapsed: false,
        onToggleCollapsed: () => setDesktopOpen(false),
      })
    : sidebar;
  const sidebarCollapsed = isValidElement(sidebar)
    ? cloneElement(sidebar as ReactElement<any>, {
        collapsed: true,
        onToggleCollapsed: () => setDesktopOpen(true),
      })
    : sidebar;

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-white font-sans">
      {/* ─── Desktop sidebar (inline-push, expanded state) ─────────────── */}
      {!isMobile && desktopOpen && (
        <div className="hidden lg:flex shrink-0 relative">
          {sidebarExpanded}
          {/* Collapse chevron pinned to the inner edge — Sidebar itself
              doesn't render a chevron in expanded mode, so we add one here. */}
          <button
            onClick={() => setDesktopOpen(false)}
            className="absolute top-3 end-2 p-1.5 rounded-md text-[#787774] hover:bg-[#EFEFED] z-10"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      )}

      {/* ─── Desktop rail (iconified Sidebar) ─────────────────────────── */}
      {!isMobile && !desktopOpen && (
        <div className="hidden lg:flex shrink-0">
          {sidebarCollapsed}
        </div>
      )}

      {/* ─── Mobile drawer (slide-in overlay) ──────────────────────────── */}
      {isMobile && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
              drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            aria-hidden={!drawerOpen}
          />
          <div
            className={`fixed start-0 top-0 z-50 h-dvh w-[78%] max-w-[300px] bg-[#F7F7F5] border-e border-[#E8E8E6] shadow-xl transform transition-transform duration-200 ease-out ${
              drawerOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
            }`}
            role="dialog"
            aria-modal="true"
          >
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 end-3 z-10 p-1.5 rounded-md text-[#787774] hover:bg-[#EFEFED]"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {sidebarWithClose}
          </div>
        </>
      )}

      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {isMobile && (
          <header className="flex items-center gap-2 px-3 py-2 border-b border-[#E8E8E6] bg-white shrink-0">
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-md text-[#37352F] hover:bg-[#F7F7F5] active:bg-[#EFEFED]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-[#37352F] tracking-tight">StudyAgent</span>
            </div>
          </header>
        )}

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {children}
        </div>
      </main>

      <ToastContainer />
    </div>
  );
}
