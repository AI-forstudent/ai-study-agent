import { useState } from 'react';
import { GitBranch, Globe, LayoutList, Network, AlignLeft, Shield, SlidersHorizontal } from 'lucide-react';
import UsageSection from './UsageSection';
import AdminPage from '../../features/admin/components/AdminPage';
import type { Me } from '../../hooks/useMe';

interface SettingsProps {
  treeViewMode: 'miller' | 'breadcrumbs' | 'graph';
  setTreeViewMode: (mode: 'miller' | 'breadcrumbs' | 'graph') => void;
  /** Authenticated user record. Drives the conditional Admin tab. */
  me: Me | null;
  /** Forwarded to AdminPage so a self-grant/revoke refreshes the sidebar. */
  onRolesChanged: () => void;
}

type SettingsTab = 'general' | 'admin';

// ── Option button used in each preference group ─────────────────────────────

interface OptionButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  description: string;
}

function OptionButton({ active, onClick, icon: Icon, label, description }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg border text-start transition-colors duration-150 ${
        active
          ? 'bg-indigo-50 border-indigo-300 text-[#37352F]'
          : 'bg-white border-[#E8E8E6] text-[#787774] hover:bg-[#F7F7F5] hover:border-[#C4C4C4]'
      }`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-indigo-600' : 'text-[#C4C4C4]'}`} />
      <div>
        <p className={`text-sm font-medium leading-none mb-0.5 ${active ? 'text-[#37352F]' : 'text-[#787774]'}`}>
          {label}
        </p>
        <p className="text-xs text-[#787774]">{description}</p>
      </div>
      {/* Active indicator dot */}
      <div className="ms-auto mt-1 shrink-0">
        <div className={`w-2 h-2 rounded-full transition-colors ${active ? 'bg-indigo-600' : 'bg-[#E8E8E6]'}`} />
      </div>
    </button>
  );
}

// ── Section card wrapper ─────────────────────────────────────────────────────

interface SectionCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SectionCard({ icon: Icon, title, description, children }: SectionCardProps) {
  return (
    <div className="bg-white border border-[#E8E8E6] rounded-xl p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-7 h-7 rounded-lg bg-[#F7F7F5] border border-[#E8E8E6] flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-[#787774]" />
        </div>
        <h2 className="text-sm font-semibold text-[#37352F]">{title}</h2>
      </div>
      <p className="text-xs text-[#787774] mb-5 ms-10">{description}</p>
      {children}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

const TREE_OPTIONS: { value: 'miller' | 'breadcrumbs' | 'graph'; icon: React.ElementType; label: string; description: string }[] = [
  { value: 'miller',      icon: LayoutList, label: 'Miller Columns', description: 'Side-by-side columns showing the thread hierarchy' },
  { value: 'breadcrumbs', icon: AlignLeft,  label: 'Breadcrumbs',    description: 'Linear path showing the active thread trail' },
  { value: 'graph',       icon: Network,    label: 'Graph View',     description: 'Visual node graph of all conversation branches' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en',  label: 'English',      disabled: false },
  // RTL stays disabled until full bidi/RTL rendering across all components
  // is verified — half-baked RTL leaks into PDFs and chat bubbles.
  { value: 'he',  label: 'Hebrew (RTL)', disabled: true  },
];

export default function Settings({ treeViewMode, setTreeViewMode, me, onRolesChanged }: SettingsProps) {
  const [language, setLanguage] = useState('en');
  const [tab, setTab] = useState<SettingsTab>('general');

  const handleLanguageChange = (value: string) => {
    setLanguage(value);
    console.log('Language switch coming soon:', value);
  };

  const showAdminTab = !!me?.has_admin_role;

  return (
    <div className="h-full bg-[#F7F7F5] flex flex-col min-h-0" dir="ltr">

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E8E8E6] px-6 py-4 shrink-0">
        <h1 className="text-base font-semibold text-[#37352F]">Settings</h1>
      </div>

      {/* ── Tabs (only shown when admin) ───────────────────────────────── */}
      {showAdminTab && (
        <div className="bg-white border-b border-[#E8E8E6] px-3 sm:px-6 shrink-0 overflow-x-auto">
          <div className="flex max-w-2xl mx-auto">
            <button
              onClick={() => setTab('general')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 whitespace-nowrap ${
                tab === 'general'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-[#787774] hover:text-[#37352F]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              General
            </button>
            <button
              onClick={() => setTab('admin')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 whitespace-nowrap ${
                tab === 'admin'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-[#787774] hover:text-[#37352F]'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Admin
            </button>
          </div>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {tab === 'general' && (
        <main className="flex-1 min-h-0 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full flex flex-col gap-5">
          {/* Section — Usage (F-005 Phase 4) */}
          <UsageSection />

          {/* Section A — Display Preferences */}
          <SectionCard
            icon={GitBranch}
            title="Display Preferences"
            description="Choose how the chat history tree is displayed in the study workspace."
          >
            <div className="flex flex-col gap-2">
              {TREE_OPTIONS.map(opt => (
                <OptionButton
                  key={opt.value}
                  active={treeViewMode === opt.value}
                  onClick={() => setTreeViewMode(opt.value)}
                  icon={opt.icon}
                  label={opt.label}
                  description={opt.description}
                />
              ))}
            </div>
          </SectionCard>

          {/* Section B — Language & Region */}
          <SectionCard
            icon={Globe}
            title="Language & Region"
            description="Interface language support. Full RTL layout for Hebrew is coming soon."
          >
            <div className="flex flex-col gap-2">
              {LANGUAGE_OPTIONS.map(opt => {
                const isActive = language === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => !opt.disabled && handleLanguageChange(opt.value)}
                    disabled={opt.disabled}
                    title={opt.disabled ? 'RTL layout is still being polished and will be enabled once it works end-to-end.' : undefined}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-start transition-colors duration-150 ${
                      opt.disabled
                        ? 'bg-[#F7F7F5] border-[#E8E8E6] opacity-50 cursor-not-allowed'
                        : isActive
                          ? 'bg-indigo-50 border-indigo-300'
                          : 'bg-white border-[#E8E8E6] hover:bg-[#F7F7F5] hover:border-[#C4C4C4]'
                    }`}
                  >
                    <span className={`text-sm font-medium ${isActive && !opt.disabled ? 'text-[#37352F]' : 'text-[#787774]'}`}>
                      {opt.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {opt.disabled && (
                        <span className="text-xs text-[#C4C4C4] border border-[#E8E8E6] px-1.5 py-0.5 rounded-md bg-white">
                          Coming soon
                        </span>
                      )}
                      <div className={`w-2 h-2 rounded-full transition-colors ${isActive && !opt.disabled ? 'bg-indigo-600' : 'bg-[#E8E8E6]'}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </main>
      )}

      {tab === 'admin' && showAdminTab && me && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <AdminPage me={me} onRolesChanged={onRolesChanged} />
        </div>
      )}

    </div>
  );
}
