import { useEffect, useState } from 'react';
import { api } from '../services/api';

export interface RoleAssignmentLite {
  id:          number;
  role:        'super_user' | 'org_admin' | 'community_admin' | 'course_admin' | 'member';
  scope_type:  'platform' | 'organization' | 'community' | 'course';
  scope_id:    number | null;
  granted_via: string;
}

export interface Me {
  id:                   number;
  email:                string;
  auth_provider:        string;
  subscription_tier:    string;
  home_organization_id: number | null;
  is_super_user:        boolean;
  has_admin_role:       boolean;
  role_assignments:     RoleAssignmentLite[];
}

/**
 * Fetches /api/v1/auth/me on mount (and again whenever `isAuthenticated`
 * flips to true) so the Admin sidebar entry knows whether to render.
 *
 * Returns:
 *   - `me`: the user identity + role assignments (or null while loading)
 *   - `refresh()`: re-pulls /me — call after granting / revoking a role
 *     so the sidebar updates without a page reload.
 */
export function useMe(isAuthenticated: boolean) {
  const [me, setMe] = useState<Me | null>(null);

  const refresh = async () => {
    if (!isAuthenticated) {
      setMe(null);
      return;
    }
    try {
      const res = await api.getMe();
      setMe(res.data);
    } catch (err) {
      // 401 from a stale token surfaces here; let the auth flow handle it.
      console.error('[useMe] failed to fetch /auth/me', err);
      setMe(null);
    }
  };

  useEffect(() => { void refresh(); }, [isAuthenticated]);

  return { me, refresh };
}
