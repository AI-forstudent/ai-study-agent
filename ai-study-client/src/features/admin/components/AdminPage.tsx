import { useEffect, useMemo, useState } from 'react';
import {
  Shield, Plus, Trash2, Loader2, Search, Building2, Users as UsersIcon, Network,
} from 'lucide-react';
import PageContainer from '../../../components/layout/PageContainer';
import PageHeader from '../../../components/layout/PageHeader';
import { api } from '../../../services/api';
import type { Me } from '../../../hooks/useMe';

// ── Types (mirrors the backend admin router responses) ───────────────────

interface AdminUser {
  id:                   number;
  email:                string;
  auth_provider:        string;
  subscription_tier:    string;
  home_organization_id: number | null;
  created_at:           string;
}

interface AdminOrg {
  id:         number;
  name:       string;
  slug:       string;
  created_at: string;
}

interface AdminCommunity {
  id:              number;
  organization_id: number;
  name:            string;
  slug:            string;
  created_at:      string;
}

type Role       = 'super_user' | 'org_admin' | 'community_admin' | 'course_admin' | 'member';
type ScopeType  = 'platform' | 'organization' | 'community' | 'course';

interface AdminRoleAssignment {
  id:           number;
  user_id:      number;
  user_email:   string;
  role:         Role;
  scope_type:   ScopeType;
  scope_id:     number | null;
  granted_by:   number | null;
  granted_via:  string;
  granted_at:   string;
}

type Tab = 'orgs' | 'users' | 'roles';

interface AdminPageProps {
  me: Me;
  /** Refresh /auth/me after a role-assignment change so the sidebar
   *  Admin entry stays in sync if the user grants themselves or strips
   *  their own admin role. */
  onRolesChanged: () => void;
}


// ── Tab body: Organizations ──────────────────────────────────────────────

function OrgsTab() {
  const [orgs, setOrgs]               = useState<AdminOrg[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [name, setName]               = useState('');
  const [slug, setSlug]               = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.adminListOrganizations();
      setOrgs(res.data);
    } catch (err) {
      console.error('[AdminOrgsTab] list failed', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.adminCreateOrganization({ name: name.trim(), slug: slug.trim() });
      setShowCreate(false);
      setName('');
      setSlug('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to create organization');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#37352F]">All organizations</h3>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          New organization
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-[#E8E8E6] rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-[#787774] block mb-1">Name</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ben-Gurion University of the Negev"
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#787774] block mb-1">Slug (URL-safe, lowercase)</label>
            <input
              required
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="bgu"
              pattern="^[a-z0-9][a-z0-9-]*$"
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-[#787774] hover:bg-[#F7F7F5] rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !slug.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#787774] py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-sm text-[#787774] py-8 text-center">No organizations yet.</div>
      ) : (
        <div className="overflow-hidden bg-white border border-[#E8E8E6] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F7F5] text-xs uppercase tracking-wide text-[#787774]">
              <tr>
                <th className="text-start font-semibold px-4 py-2">Name</th>
                <th className="text-start font-semibold px-4 py-2 font-mono">Slug</th>
                <th className="text-start font-semibold px-4 py-2">ID</th>
                <th className="text-start font-semibold px-4 py-2">Communities</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(o => (
                <OrgRow key={o.id} org={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function OrgRow({ org }: { org: AdminOrg }) {
  const [expanded, setExpanded]       = useState(false);
  const [communities, setCommunities] = useState<AdminCommunity[]>([]);
  const [loading, setLoading]         = useState(false);
  const [showCreate, setShowCreate]   = useState(false);
  const [name, setName]               = useState('');
  const [slug, setSlug]               = useState('');
  const [error, setError]             = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.adminListCommunities(org.id);
      setCommunities(res.data);
    } catch (err) {
      console.error('[OrgRow] community list failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) void refresh();
  }, [expanded]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.adminCreateCommunity({ organization_id: org.id, name: name.trim(), slug: slug.trim() });
      setShowCreate(false);
      setName('');
      setSlug('');
      await refresh();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to create community');
    }
  }

  return (
    <>
      <tr
        onClick={() => setExpanded(v => !v)}
        className="border-t border-[#E8E8E6] hover:bg-[#F7F7F5] cursor-pointer"
      >
        <td className="px-4 py-2 font-medium text-[#37352F]">{org.name}</td>
        <td className="px-4 py-2 font-mono text-xs text-[#787774]">{org.slug}</td>
        <td className="px-4 py-2 text-xs text-[#787774]">{org.id}</td>
        <td className="px-4 py-2 text-xs text-indigo-600">{expanded ? 'Hide ▴' : 'Show ▾'}</td>
      </tr>
      {expanded && (
        <tr className="bg-[#FAFAFA] border-t border-[#E8E8E6]">
          <td colSpan={4} className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#787774]">
                Communities
              </span>
              <button
                onClick={() => setShowCreate(v => !v)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-md"
              >
                <Plus className="w-3 h-3" /> New community
              </button>
            </div>

            {showCreate && (
              <form onSubmit={handleCreate} className="bg-white border border-[#E8E8E6] rounded-lg p-3 mb-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Computer Science Faculty"
                    className="flex-1 bg-white border border-[#E8E8E6] rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <input
                    required
                    value={slug}
                    onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    placeholder="cs"
                    pattern="^[a-z0-9][a-z0-9-]*$"
                    className="w-32 bg-white border border-[#E8E8E6] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button type="submit" className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md">
                    Create
                  </button>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
              </form>
            )}

            {loading ? (
              <p className="text-xs text-[#787774]">Loading…</p>
            ) : communities.length === 0 ? (
              <p className="text-xs text-[#C4C4C4] italic">No communities in this org yet.</p>
            ) : (
              <ul className="space-y-1">
                {communities.map(c => (
                  <li key={c.id} className="flex items-center gap-2 text-xs text-[#37352F]">
                    <span className="font-medium">{c.name}</span>
                    <span className="font-mono text-[#787774]">{c.slug}</span>
                    <span className="text-[#C4C4C4]">id={c.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}


// ── Tab body: Users ──────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]         = useState<AdminUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  const refresh = async (q?: string) => {
    setLoading(true);
    try {
      const res = await api.adminListUsers(q);
      setUsers(res.data);
    } catch (err) {
      console.error('[UsersTab] list failed', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C4C4C4]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void refresh(search.trim() || undefined); }}
            placeholder="Search by email…"
            className="w-full bg-white border border-[#E8E8E6] rounded-lg ps-9 pe-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
          />
        </div>
        <button
          onClick={() => void refresh(search.trim() || undefined)}
          className="px-3 py-2 text-sm font-medium text-[#37352F] bg-white border border-[#E8E8E6] hover:bg-[#F7F7F5] rounded-lg"
        >
          Search
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#787774] py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-hidden bg-white border border-[#E8E8E6] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F7F5] text-xs uppercase tracking-wide text-[#787774]">
              <tr>
                <th className="text-start font-semibold px-4 py-2">ID</th>
                <th className="text-start font-semibold px-4 py-2">Email</th>
                <th className="text-start font-semibold px-4 py-2">Auth</th>
                <th className="text-start font-semibold px-4 py-2">Tier</th>
                <th className="text-start font-semibold px-4 py-2">Home org</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-[#E8E8E6]">
                  <td className="px-4 py-2 text-xs text-[#787774]">{u.id}</td>
                  <td className="px-4 py-2 font-medium text-[#37352F]">{u.email}</td>
                  <td className="px-4 py-2 text-xs">{u.auth_provider}</td>
                  <td className="px-4 py-2 text-xs">{u.subscription_tier}</td>
                  <td className="px-4 py-2 text-xs">{u.home_organization_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Tab body: Role assignments ───────────────────────────────────────────

function RolesTab({ onRolesChanged }: { onRolesChanged: () => void }) {
  const [rows, setRows]           = useState<AdminRoleAssignment[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Form state
  const [userId, setUserId]       = useState('');
  const [role, setRole]           = useState<Role>('member');
  const [scopeType, setScopeType] = useState<ScopeType>('organization');
  const [scopeId, setScopeId]     = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.adminListRoleAssignments({});
      setRows(res.data);
    } catch (err) {
      console.error('[RolesTab] list failed', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.adminCreateRoleAssignment({
        user_id:    Number(userId),
        role,
        scope_type: scopeType,
        scope_id:   scopeType === 'platform' ? null : Number(scopeId),
      });
      setShowCreate(false);
      setUserId(''); setRole('member'); setScopeType('organization'); setScopeId('');
      await refresh();
      onRolesChanged();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to grant role');
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Revoke this role assignment?')) return;
    try {
      await api.adminDeleteRoleAssignment(id);
      await refresh();
      onRolesChanged();
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? 'Failed to revoke role');
    }
  }

  // Auto-clear scope_id when switching to platform.
  const platformOnly = role === 'super_user';
  const effectiveScopeType: ScopeType = platformOnly ? 'platform' : scopeType;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#37352F]">All role assignments</h3>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          Grant role
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-[#E8E8E6] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[#787774] block mb-1">User ID</label>
            <input
              required type="number" value={userId} onChange={e => setUserId(e.target.value)}
              placeholder="e.g. 3"
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#787774] block mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as Role)}
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            >
              <option value="member">member</option>
              <option value="course_admin">course_admin</option>
              <option value="community_admin">community_admin</option>
              <option value="org_admin">org_admin</option>
              <option value="super_user">super_user</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[#787774] block mb-1">Scope type</label>
            <select
              value={effectiveScopeType}
              onChange={e => setScopeType(e.target.value as ScopeType)}
              disabled={platformOnly}
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            >
              <option value="organization">organization</option>
              <option value="community">community</option>
              <option value="course">course</option>
              <option value="platform">platform</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[#787774] block mb-1">Scope ID</label>
            <input
              type="number"
              value={effectiveScopeType === 'platform' ? '' : scopeId}
              onChange={e => setScopeId(e.target.value)}
              disabled={effectiveScopeType === 'platform'}
              placeholder={effectiveScopeType === 'platform' ? '— (super_user only)' : '1'}
              className="w-full bg-white border border-[#E8E8E6] rounded-lg px-3 py-2 text-sm disabled:bg-[#F7F7F5] disabled:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            {error && <p className="text-xs text-red-600 self-center me-auto">{error}</p>}
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-[#787774] hover:bg-[#F7F7F5] rounded-lg">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">
              Grant
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#787774] py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[#787774] py-8 text-center">No role assignments yet.</div>
      ) : (
        <div className="overflow-hidden bg-white border border-[#E8E8E6] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F7F5] text-xs uppercase tracking-wide text-[#787774]">
              <tr>
                <th className="text-start font-semibold px-4 py-2">User</th>
                <th className="text-start font-semibold px-4 py-2">Role</th>
                <th className="text-start font-semibold px-4 py-2">Scope</th>
                <th className="text-start font-semibold px-4 py-2">Granted via</th>
                <th className="text-start font-semibold px-4 py-2">Granted at</th>
                <th className="text-end font-semibold px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-[#E8E8E6]">
                  <td className="px-4 py-2">
                    <div className="font-medium text-[#37352F]">{r.user_email}</div>
                    <div className="text-[10px] text-[#C4C4C4]">id={r.user_id}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.role}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.scope_type}{r.scope_id != null ? `/${r.scope_id}` : ''}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.granted_via}</td>
                  <td className="px-4 py-2 text-xs text-[#787774]">
                    {new Date(r.granted_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-end">
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 rounded-md text-[#C4C4C4] hover:text-red-500 hover:bg-red-50"
                      title="Revoke"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Wrapper ──────────────────────────────────────────────────────────────

export default function AdminPage({ me, onRolesChanged }: AdminPageProps) {
  const [tab, setTab] = useState<Tab>('orgs');

  const tabs = useMemo(() => [
    { id: 'orgs'  as Tab, label: 'Organizations', icon: Building2 },
    { id: 'users' as Tab, label: 'Users',         icon: UsersIcon },
    { id: 'roles' as Tab, label: 'Role Assignments', icon: Network },
  ], []);

  return (
    <PageContainer>
      <PageHeader
        title="Admin"
        subtitle={`Multi-tenancy hierarchy. You are signed in as ${me.email}${me.is_super_user ? ' (super-user)' : ''}.`}
        icon={<Shield className="w-5 h-5 text-indigo-600" />}
      />

      <div className="flex border-b border-[#E8E8E6] mb-5">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 ${
                active
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-[#787774] hover:text-[#37352F]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'orgs'  && <OrgsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab onRolesChanged={onRolesChanged} />}
    </PageContainer>
  );
}
