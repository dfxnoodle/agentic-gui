import { test, expect } from '@playwright/test';

const adminUsername = process.env.ADMIN_USERNAME ?? '';
const adminPassword = process.env.ADMIN_PASSWORD ?? '';

if (!adminUsername || !adminPassword) {
  throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in the root .env file before running Playwright tests.');
}

test.describe('Login Flow', () => {
  test('shows login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toContainText('Agentic GUI');
  });

  test('login with default admin credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="text"]', adminUsername);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/', { timeout: 5000 });
    await expect(page.locator('h2')).toContainText('Dashboard');
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="text"]', adminUsername);
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should stay on login and show error
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.error')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Authenticated Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[type="text"]', adminUsername);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/', { timeout: 5000 });
  });

  test('dashboard shows cards', async ({ page }) => {
    await expect(page.locator('.dashboard-grid')).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(4, { timeout: 3000 });
  });

  test('navigate to chat', async ({ page }) => {
    await page.click('a[href="/chat"]');
    await expect(page).toHaveURL(/\/chat/);
  });

  test('navigate to settings (admin)', async ({ page }) => {
    await page.click('a[href="/settings"]');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('.settings-tabs')).toBeVisible();
  });

  test('settings tabs switch content', async ({ page }) => {
    await page.click('a[href="/settings"]');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('.tab-content h3')).toContainText('User Management');

    await page.click('button:text("Projects")');
    await expect(page.locator('.tab-content h3')).toContainText('Projects');

    await page.click('button:text("CLI Config")');
    await expect(page.locator('.tab-content h3')).toContainText('CLI API Keys');
  });

  test('role badge shows admin', async ({ page }) => {
    await expect(page.locator('.role-badge')).toContainText('admin');
  });

  test('logout returns to login', async ({ page }) => {
    await page.click('button:text("Logout")');
    await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
  });
});
