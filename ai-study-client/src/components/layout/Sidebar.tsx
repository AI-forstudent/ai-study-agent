import React from 'react';
import { Sparkles, Library, FlaskConical, Globe, LogOut, Settings, BookOpen, GraduationCap } from 'lucide-react';

interface SidebarProps {
  activeView: 'main' | 'lab' | 'gallery' | 'settings' | 'hub';
  onNavigate: (view: 'main' | 'lab' | 'gallery' | 'settings' | 'hub') => void;
  onLogout: () => void;
  hasActiveSession?: boolean;
  onResumeSession?: () => void;
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
  badge?: boolean;
  onClick: () => void;
}

function NavItem({ icon: Icon, label, active, badge, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 text-start ${
        active
          ? 'bg-[#EFEFED] text-[#37352F] font-medium'
          : 'text-[#787774] hover:bg-[#EFEFED] hover:text-[#37352F]'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
      )}
    </button>
  );
}

// ── Main sidebar ────────────────────────────────────────────────────────────

export default function Sidebar({ activeView, onNavigate, onLogout, hasActiveSession, onResumeSession }: SidebarProps) {
  return (
    <aside className="w-60 h-screen flex flex-col bg-[#F7F7F5] border-e border-[#E8E8E6] shrink-0 overflow-hidden">

      {/* ── Logo / home ────────────────────────────────────────────────── */}
      <button
        onClick={() => onNavigate('main')}
        className="flex items-center gap-2.5 px-4 py-4 hover:bg-[#EFEFED] transition-colors duration-150 shrink-0"
      >
        <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-base font-semibold text-[#37352F] tracking-tight">StudyAgent</span>
      </button>

      <div className="border-t border-[#E8E8E6] shrink-0" />

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <div className="px-1 shrink-0">
        <SectionLabel>Workspace</SectionLabel>

        {/* Active Session — always visible; badge shows only when a session is live */}
        <NavItem
          icon={BookOpen}
          label="Active Session"
          badge={!!hasActiveSession}
          onClick={onResumeSession ?? (() => {})}
        />

        <NavItem
          icon={Library}
          label="My Library"
          active={activeView === 'main'}
          onClick={() => onNavigate('main')}
        />
        <NavItem
          icon={Globe}
          label="Community"
          active={activeView === 'gallery'}
          onClick={() => onNavigate('gallery')}
        />
        <NavItem
          icon={FlaskConical}
          label="AI Teachers"
          active={activeView === 'lab'}
          onClick={() => onNavigate('lab')}
        />
        <NavItem
          icon={GraduationCap}
          label="Personal Hub"
          active={activeView === 'hub'}
          onClick={() => onNavigate('hub')}
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
          onClick={() => onNavigate('settings')}
        />
        <NavItem
          icon={LogOut}
          label="Sign out"
          onClick={onLogout}
        />
      </div>

    </aside>
  );
}
