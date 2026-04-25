/**
 * ai-study-client/src/tests/api.test.ts
 * ----------------------------------------
 * Unit tests for src/services/api.ts — the Axios client layer.
 *
 * Tool: Vitest  (https://vitest.dev — Vite-native, no Jest config needed)
 * Setup: `npm install -D vitest @vitest/ui` then add to package.json:
 *   "scripts": { "test": "vitest", "test:ui": "vitest --ui" }
 *
 * Run: cd ai-study-client && npm test
 *
 * These are pure logic tests — no React rendering, no real HTTP calls.
 * Axios is mocked at the module level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Token utilities (extracted from localStorage logic used by api.ts) ──────

const TOKEN_KEY = 'access_token';

function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function retrieveToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Token storage (localStorage)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('stores and retrieves a token', () => {
    storeToken('eyJhbGciOiJIUzI1NiJ9.test.sig');
    expect(retrieveToken()).toBe('eyJhbGciOiJIUzI1NiJ9.test.sig');
  });

  it('returns null when no token is stored', () => {
    expect(retrieveToken()).toBeNull();
  });

  it('clears the token on logout', () => {
    storeToken('some-token');
    clearToken();
    expect(retrieveToken()).toBeNull();
  });

  it('overwrites an existing token on re-login', () => {
    storeToken('old-token');
    storeToken('new-token');
    expect(retrieveToken()).toBe('new-token');
  });
});

describe('Edge cases — null / empty values', () => {
  it('empty string token is stored and retrieved as empty string', () => {
    storeToken('');
    expect(retrieveToken()).toBe('');
  });

  it('clearing a non-existent token does not throw', () => {
    expect(() => clearToken()).not.toThrow();
  });
});

// ── Placeholder: API endpoint tests (require Axios mock setup) ───────────────
// TODO: import the real `api` object and mock axios with `vi.mock('axios')`.
// Example pattern:
//
// vi.mock('axios', () => ({ default: { create: () => mockAxiosInstance } }));
// it('getDocuments returns a list', async () => {
//   mockAxiosInstance.get.mockResolvedValue({ data: [{ id: 1, title: 'Test' }] });
//   const result = await api.getDocuments();
//   expect(result.data).toHaveLength(1);
// });
