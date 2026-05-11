import React from 'react';
import {
  Sparkles, Library, FlaskConical, Globe, LogOut, Settings,
  GraduationCap, Plus, Users, ChevronRight,
} from 'lucide-react';

type SidebarView = 'main' | 'lab' | 'gallery' | 'settings' | 'hub';

interface SidebarProps {
  activeView: SidebarView;
  onNavigate: (view: SidebarView) => void;
  onLogout: () => void;
  /** Called when the user clicks the prominent "+ New Session" button. */
  onNewSession?: () => void;
  /** Injected by AppLayout when the sidebar lives inside the mobile drawer.
   *  Every nav action calls this so the drawer dismisses on selection. */
  onCloseDrawer?: () => void;
  /** F-035 — when true, render an icon-only "rail" variant: same nav items,
   *  same active highlighting, just narrower with no labels. AppLayout
   *  flips this on when the user has collapsed the desktop sidebar. */
  collapsed?: boolean;
  /** F-035 — chevron handler injected by AppLayout to toggle the
   *  expanded/collapsed state. Rendered at the top of the iconified rail
   *  and at the top of the expanded sidebar. */
  onToggleCollapsed?: () => void;
}

// ── Reusable sub-components ─────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[#C4C4C4] select-none">
      {children}
    </p>
  );
}

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string;
  onClick: () => void;
}

function NavItem({ icon: Icon, label, active, disabled, badge, onClick }: NavItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 lg:py-1.5 rounded-md text-sm transition-colors duration-150 text-start ${
        disabled
          ? 'text-[#C4C4C4] cursor-not-allowed'
          : active
            ? 'bg-[#EFEFED] text-[#37352F] font-medium'
            : 'text-[#787774] hover:bg-[#EFEFED] hover:text-[#37352F]'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-[#F7F7F5] text-[#C4C4C4] border border-[#E8E8E6]">
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Main sidebar ────────────────────────────────────────────────────────────

export default function Sidebar({
  activeView, onNavigate, onLogout, onNewSession, onCloseDrawer,
  collapsed, onToggleCollapsed,
}: SidebarProps) {
  // Dismiss the mobile drawer (no-op on desktop) on every nav-style action.
  const nav = (v: SidebarView) => { onNavigate(v); onCloseDrawer?.(); };
  const newSession = () => { onNewSession?.(); onCloseDrawer?.(); };
  const logout = () => { onCloseDrawer?.(); onLogout(); };

  if (collapsed) {
    return <CollapsedSidebar
      activeView={activeView}
      onNavigate={nav}
      onLogout={logout}
      onNewSession={newSession}
      onToggleCollapsed={onToggleCollapsed}
    />;
  }

  return (
    <aside className="w-full lg:w-60 h-full lg:h-screen flex flex-col bg-[#F7F7F5] lg:border-e lg:border-[#E8E8E6] shrink-0 overflow-y-auto">

      {/* ── Logo / home ────────────────────────────────────────────────── */}
      <button
        onClick={() => nav('main')}
        className="flex items-center gap-2.5 px-4 py-4 hover:bg-[#EFEFED] transition-colors duration-150 shrink-0"
      >
        <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-base font-semibold text-[#37352F] tracking-tight">StudyAgent</span>
      </button>

      <div className="border-t border-[#E8E8E6] shrink-0" />

      {/* ── + New Session — prominent CTA above the nav ────────────────── */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={newSession}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <div className="px-1 shrink-0">
        <SectionLabel>Workspace</SectionLabel>

        <NavItem
          icon={Library}
          label="My Library"
          active={activeView === 'main'}
          onClick={() => nav('main')}
        />
        <NavItem
          icon={Globe}
          label="Courses"
          active={activeView === 'gallery'}
          onClick={() => nav('gallery')}
        />
        <NavItem
          icon={Users}
          label="Communities"
          disabled
          badge="Soon"
          onClick={() => {}}
        />
        <NavItem
          icon={FlaskConical}
          label="AI Teachers"
          active={activeView === 'lab'}
          onClick={() => nav('lab')}
        />
        <NavItem
          icon={GraduationCap}
          label="My Space"
          active={activeView === 'hub'}
          onClick={() => nav('hub')}
        />
      </div>

      {/* ── Spacer ─────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      <div className="border-t border-[#E8E8E6] shrink-0" />

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="px-1 py-2 shrink-0">
        <NavItem
          icon={Settings}
          label="Settings"
          active={activeView === 'settings'}
          onClick={() => nav('settings')}
        />
        <NavItem
          icon={LogOut}
          label="Sign out"
          onClick={logout}
        />
      </div>

    </aside>
  );
}


// ── Iconified rail variant (F-035) ───────────────────────────────────────────
// Same nav items as the expanded sidebar, just icons-only. Lets the user
// navigate at any time even when the sidebar is collapsed inside a session.

interface CollapsedSidebarProps {
  activeView: SidebarView;
  onNavigate: (view: SidebarView) => void;
  onLogout: () => void;
  onNewSession: () => void;
  onToggleCollapsed?: () => void;
}

function CollapsedSidebar({
  activeView, onNavigate, onLogout, onNewSession, onToggleCollapsed,
}: CollapsedSidebarProps) {
  return (
    <aside className="w-14 h-full lg:h-screen flex flex-col items-center bg-[#F7F7F5] lg:border-e lg:border-[#E8E8E6] shrink-0 py-2">
      {/* Expand chevron (and logo as a fallback when no toggle provided) */}
      {onToggleCollapsed ? (
        <button
          onClick={onToggleCollapsed}
          className="p-2 rounded-md text-[#37352F] hover:bg-[#EFEFED]"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <ChevronRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      ) : (
        <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center" title="StudyAgent">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
      )}

      <div className="w-8 border-t border-[#E8E8E6] my-2" />

      {/* + New session — same prominent CTA, icon-only */}
      <button
        onClick={onNewSession}
        className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
        title="New Session"
        aria-label="New Session"
      >
        <Plus className="w-4 h-4" />
      </button>

      <div className="mt-2 flex flex-col items-center gap-1">
        <IconNavButton
          icon={Library} label="My Library"
          active={activeView === 'main'}
          onClick={() => onNavigate('main')}
        />
        <IconNavButton
          icon={Globe} label="Courses"
          active={activeView === 'gallery'}
          onClick={() => onNavigate('gallery')}
        />
        <IconNavButton
          icon={Users} label="Communities · soon"
          disabled
          onClick={() => {}}
        />
        <IconNavButton
          icon={FlaskConical} label="AI Teachers"
          active={activeView === 'lab'}
          onClick={() => onNavigate('lab')}
        />
        <IconNavButton
          icon={GraduationCap} label="My Space"
          active={activeView === 'hub'}
          onClick={() => onNavigate('hub')}
        />
      </div>

      {/* Spacer pushes settings/logout to the bottom */}
      <div className="flex-1" />

      <div className="w-8 border-t border-[#E8E8E6] my-2" />

      <IconNavButton
        icon={Settings} label="Settings"
        active={activeView === 'settings'}
        onClick={() => onNavigate('settings')}
      />
      <IconNavButton
        icon={LogOut} label="Sign out"
        onClick={onLogout}
      />
    </aside>
  );
}

function IconNavButton({
  icon: Icon, label, active, disabled, onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`p-2 rounded-md transition-colors duration-150 ${
        disabled
          ? 'text-[#C4C4C4] cursor-not-allowed'
          : active
            ? 'bg-[#EFEFED] text-[#37352F]'
            : 'text-[#787774] hover:bg-[#EFEFED] hover:text-[#37352F]'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

