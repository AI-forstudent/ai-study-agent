import { useEffect, useState, cloneElement, isValidElement, type ReactElement } from 'react';
import { Menu, X, Sparkles, ChevronRight } from 'lucide-react';
import ToastContainer from '../ui/ToastContainer';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useAppStore } from '../../store/useAppStore';

interface AppLayoutProps {
  /** Sidebar component. On phone/tablet it renders inside a slide-in drawer
   *  and is passed an extra `onClose` prop so nav clicks dismiss the drawer.
   *  On desktop while `inSession=true` (F-033), the sidebar collapses to a
   *  thin rail and slides out as a drawer on chevron click — the same
   *  pattern as mobile but available on desktop too. */
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function AppLayout({ sidebar, children }: AppLayoutProps) {
  const { isMobile } = useBreakpoint();
  const inSession = useAppStore(s => s.inSession);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Drawer open/close lifecycle ────────────────────────────────────────
  // Mobile uses a drawer always (no inline sidebar). Desktop uses a drawer
  // ONLY when inSession=true; otherwise the sidebar is inline. We treat
  // "drawer mode" as a derived flag so the desktop close-on-viewport-switch
  // effect still cleans up on resize between modes.
  const drawerMode = isMobile || inSession;
  useEffect(() => {
    if (!drawerMode && drawerOpen) setDrawerOpen(false);
  }, [drawerMode, drawerOpen]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  // Inject onClose into the sidebar element when rendering it inside the drawer
  // so nav clicks dismiss the drawer automatically.
  const sidebarWithClose = isValidElement(sidebar)
    ? cloneElement(sidebar as ReactElement<any>, { onCloseDrawer: () => setDrawerOpen(false) })
    : sidebar;

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-white font-sans">
      {/* Desktop sidebar — inline only when not in a session */}
      {!isMobile && !inSession && (
        <div className="hidden lg:flex shrink-0">
          {sidebar}
        </div>
      )}

      {/* Desktop in-session collapsed rail — a thin column with an expand chevron.
          Mobile keeps using the hamburger top-bar; we don't show the rail there. */}
      {!isMobile && inSession && (
        <div className="hidden lg:flex flex-col items-center gap-2 w-12 border-e border-[#E8E8E6] bg-[#F7F7F5] shrink-0 py-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-md text-[#37352F] hover:bg-[#EFEFED]"
            title="Open menu"
            aria-label="Open menu"
          >
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
          <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center" title="StudyAgent">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      )}

      {/* Drawer (mobile always, desktop in-session) — slides in from the start side */}
      {drawerMode && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setDrawerOpen(false)}
            className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
              drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            aria-hidden={!drawerOpen}
          />
          {/* Drawer */}
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
        {/* Mobile/Tablet top bar with hamburger — desktop in-session uses the rail instead */}
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
