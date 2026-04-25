/**
 * tests/e2e/auth.spec.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Playwright E2E tests for the authentication flow.
 *
 * Prerequisites:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *
 * Run:
 *   npx playwright test tests/e2e/
 *   npx playwright test tests/e2e/ --headed        # watch the browser
 *   npx playwright test tests/e2e/ --reporter=html  # HTML report
 *
 * The base URL is read from PLAYWRIGHT_BASE_URL env var (default: localhost:5173
 * for Vite dev server, or localhost:80 for Docker).
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// ── Guest login ───────────────────────────────────────────────────────────────

test.describe('Guest login flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('landing page loads without errors', async ({ page }) => {
    await expect(page).not.toHaveTitle(/error/i);
    // The landing page must have a visible CTA — adjust selector to match LandingPage.tsx
    await expect(page.getByRole('button', { name: /get started|sign in|login/i }).first()).toBeVisible();
  });

  test('guest login grants access to the main workspace', async ({ page }) => {
    // Open the auth modal
    await page.getByRole('button', { name: /get started|sign in/i }).first().click();

    // Click "Continue as Guest"
    await page.getByRole('button', { name: /guest|demo|continue without/i }).click();

    // After guest login, the sidebar should be visible
    await expect(page.getByText(/my library|workspace/i).first()).toBeVisible({ timeout: 10_000 });

    // Access token should be persisted to localStorage
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(token).not.toBeNull();
    expect(token!.length).toBeGreaterThan(0);
  });
});

// ── Registration ──────────────────────────────────────────────────────────────

test.describe('User registration', () => {
  const testEmail = `test_${Date.now()}@playwright.dev`;
  const testPassword = 'Playwright!Test123';

  test('new user can register and reach the workspace', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('button', { name: /get started|sign in/i }).first().click();

    await page.getByPlaceholder(/email/i).fill(testEmail);
    await page.getByPlaceholder(/password/i).fill(testPassword);
    await page.getByRole('button', { name: /register|create account|sign up/i }).click();

    await expect(page.getByText(/my library|workspace/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test.describe('Auth edge cases', () => {
  test('login with wrong credentials shows an error', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('button', { name: /get started|sign in/i }).first().click();

    await page.getByPlaceholder(/email/i).fill('nobody@nowhere.com');
    await page.getByPlaceholder(/password/i).fill('wrong-password');
    await page.getByRole('button', { name: /^sign in$|^login$/i }).click();

    await expect(page.getByText(/incorrect|invalid|wrong|error/i)).toBeVisible({ timeout: 5_000 });
  });

  test('duplicate registration is rejected', async ({ page }) => {
    const dupeEmail = `dupe_${Date.now()}@playwright.dev`;

    // First registration
    await page.goto(BASE_URL);
    await page.getByRole('button', { name: /get started|sign in/i }).first().click();
    await page.getByPlaceholder(/email/i).fill(dupeEmail);
    await page.getByPlaceholder(/password/i).fill('ValidPass!1');
    await page.getByRole('button', { name: /register|create account|sign up/i }).click();
    await expect(page.getByText(/my library|workspace/i).first()).toBeVisible({ timeout: 10_000 });

    // Logout
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Second registration with same email
    await page.getByRole('button', { name: /get started|sign in/i }).first().click();
    await page.getByPlaceholder(/email/i).fill(dupeEmail);
    await page.getByPlaceholder(/password/i).fill('ValidPass!1');
    await page.getByRole('button', { name: /register|create account|sign up/i }).click();

    await expect(page.getByText(/already registered|already exists|email taken/i)).toBeVisible({ timeout: 5_000 });
  });
});
