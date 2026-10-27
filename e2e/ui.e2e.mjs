/**
 * Browser end-to-end check of the main flows (requires Playwright + Chromium).
 * Usage: npm run build:css && npm run test:e2e
 * Env: E2E_PORT (default 3508), E2E_SCREENSHOTS (directory, optional).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = Number(process.env.E2E_PORT ?? 3508);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.E2E_SCREENSHOTS;
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-e2e-'));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  DB_PATH: path.join(dbDir, 'chat.db'),
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
  PERSIST_INTERVAL_MS: '100',
  LOG_LEVEL: 'warn',
};

function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  return child;
}
async function waitReady() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/readyz`)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become ready');
}
const stop = (child) =>
  new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const consoleErrors = [];
async function newUser(browser, name, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${name}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`[${name}] ${err.message}`));
  page.on('dialog', (dialog) => {
    consoleErrors.push(`[${name}] unexpected dialog (XSS?): ${dialog.message()}`);
    dialog.dismiss();
  });
  await page.goto(BASE);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Join workspace' }).click();
  await page.getByText('Online', { exact: true }).waitFor({ state: 'attached' });
  return { context, page };
}
const shot = async (page, name) =>
  SHOTS &&
  (await page.waitForTimeout(400), page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }));

let server = startServer();
const browser = await chromium.launch();
try {
  await waitReady();

  // login validation (empty name)
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(BASE);
    await shot(page, '01-login');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await page.getByText('Please enter a display name.').waitFor();
    await context.close();
  }

  const ana = await newUser(browser, 'Ana');
  const bob = await newUser(browser, '<img src=x onerror=alert(1)>');

  // XSS: hostile username and message are rendered as text
  const payload = '<script>window.__xss=2</script><b>bold?</b>';
  await bob.page.getByRole('textbox', { name: 'Message', exact: true }).fill(payload);
  await bob.page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await ana.page.getByText(payload).waitFor();
  await ana.page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor();
  assert((await ana.page.evaluate(() => window.__xss)) === undefined, 'XSS payload executed');
  assert((await ana.page.locator('#message-list b').count()) === 0, 'HTML was interpreted');

  // read receipt: Ana is viewing the channel, so Bob's message turns "Read"
  await bob.page.locator('[data-status="read"]').first().waitFor();

  // typing indicator
  await ana.page.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially('hel');
  await bob.page.getByText('Ana is typing…').waitFor();
  await ana.page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await bob.page.locator('#message-list').getByText('hel', { exact: true }).waitFor();
  await shot(ana.page, '02-chat-desktop');

  // channels: create, see it appear for the other user, unread badge
  await ana.page.getByLabel('New channel name').fill('Dev Team');
  await ana.page.getByRole('button', { name: 'Create channel' }).click();
  await ana.page.getByRole('heading', { name: '# Dev Team' }).waitFor();
  await bob.page.getByRole('button', { name: /Dev Team/ }).waitFor();
  await ana.page.getByRole('textbox', { name: 'Message', exact: true }).fill('in dev');
  await ana.page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await bob.page.getByLabel('1 unread').waitFor();
  await ana.page.getByText('No messages yet').waitFor({ state: 'hidden' });

  // search filter
  await bob.page.getByLabel('Search channels').fill('dev');
  assert((await bob.page.locator('#channel-list li').count()) === 1, 'search should filter channels');
  await bob.page.getByLabel('Search channels').fill('');

  // reconnection + catch-up: restart the server while Bob is offline from it
  await stop(server);
  await ana.page.getByText('Connection lost. Reconnecting…', { exact: false }).waitFor();
  await ana.page.getByRole('textbox', { name: 'Message', exact: true }).fill('sent while offline');
  await ana.page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await shot(ana.page, '03-offline');
  server = startServer();
  await waitReady();
  await ana.page.getByText('Online', { exact: true }).waitFor({ timeout: 40_000 });
  await bob.page.getByText('Online', { exact: true }).waitFor({ timeout: 40_000 });
  await bob.page.getByRole('button', { name: /Dev Team/ }).click();
  await bob.page.locator('#message-list').getByText('sent while offline').waitFor();
  await ana.page
    .locator('li', { hasText: 'sent while offline' })
    .locator('[data-status="read"], [data-status="sent"]')
    .waitFor();

  // mobile layout (390px): sidebar hidden behind the menu button, no horizontal scroll
  const mobile = await newUser(browser, 'Mobile', { width: 390, height: 844 });
  const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, 'horizontal overflow at 390px');
  await shot(mobile.page, '04-mobile-chat');
  await mobile.page.getByRole('button', { name: 'Open channel list' }).click();
  await mobile.page.getByRole('button', { name: /Dev Team/ }).click();
  await mobile.page.getByRole('heading', { name: '# Dev Team' }).waitFor();
  await mobile.page.locator('#message-list').getByText('in dev').waitFor();
  await shot(mobile.page, '05-mobile-channel');
  await mobile.page.getByRole('button', { name: 'Open channel list' }).click();
  await shot(mobile.page, '06-mobile-sidebar');

  // sign out returns to the login screen
  await mobile.page.getByRole('button', { name: 'Sign out' }).click();
  await mobile.page.getByLabel('Display name').waitFor();

  // API docs render under the CSP
  const docs = await browser.newPage();
  docs.on('pageerror', (err) => consoleErrors.push(`[docs] ${err.message}`));
  docs.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(`[docs] ${msg.text()}`));
  await docs.goto(`${BASE}/api-docs`);
  await docs.getByText('NexusChat REST API').first().waitFor();
  await shot(docs, '07-api-docs');

  // Expected: the browser logs failed WebSocket attempts while the server was down.
  const unexpected = consoleErrors.filter((e) => !/WebSocket connection to .* failed/.test(e));
  assert(unexpected.length === 0, `console errors:\n${unexpected.join('\n')}`);
  console.log('E2E OK');
} finally {
  await browser.close();
  await stop(server);
  fs.rmSync(dbDir, { recursive: true, force: true });
}
