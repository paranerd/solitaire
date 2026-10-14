import { expect, test as base, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface UpdateServer { url: string; version: number; failInstall: boolean }
const test = base.extend<{ updateServer: UpdateServer }>({
  updateServer: async ({}, use) => {
    const state: UpdateServer = { url: '', version: 1, failInstall: false };
    const directory = path.resolve('dist');
    const server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url!, 'http://localhost').pathname;
        if (!pathname.startsWith('/solitaire/')) { response.writeHead(404).end(); return; }
        const relative = pathname.slice('/solitaire/'.length) || 'index.html';
        if (state.failInstall && relative === 'icon-192.png') { response.writeHead(503).end(); return; }
        const filename = path.resolve(directory, relative);
        if (!filename.startsWith(directory + path.sep)) { response.writeHead(404).end(); return; }
        let body = await readFile(filename);
        if (relative === 'sw.js') body = Buffer.from(body.toString().replace(/const CACHE = .*?;/, `const CACHE = "solitaire-test-${state.version}";`));
        if (relative === 'index.html') body = Buffer.from(body.toString().replace('<body>', `<body data-test-build="${state.version}">`));
        const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
        response.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(body);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    state.url = `http://127.0.0.1:${address.port}/solitaire/`;
    try { await use(state); }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  },
});
async function openSettings(page: Page): Promise<void> {
  const toggle = page.locator('#actions-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
}
async function installFirstVersion(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-test-build', '1');
  await expect(page.getByRole('region', { name: 'App-Update' })).toBeHidden();
}
async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
}
for (const source of ['banner', 'settings'] as const) {
  test(`updates from ${source} preserve the game and load the new cached version`, async ({ page, context, updateServer }) => {
    await installFirstVersion(page, updateServer.url);
    await page.locator('#stock').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('solitaire:v1:game:classic-1')!));
    expect(saved.actions).toHaveLength(1);
    if (source === 'settings') await openSettings(page);
    updateServer.version = 2;
    await checkForUpdate(page);
    await expect(page.locator('#update-banner')).toBeVisible();
    if (source === 'settings') {
      // The already-open settings must reflect an update arriving in the background.
      await expect(page.locator('#settings-update')).toBeVisible();
      await page.getByRole('button', { name: 'Zurück zum Spiel', exact: true }).click();
      await page.getByRole('button', { name: 'Später', exact: true }).click();
      await expect(page.locator('#update-banner')).toBeHidden();
      await expect(page.locator('body')).toHaveAttribute('data-test-build', '1');
      await openSettings(page);
      await expect(page.locator('#settings-update')).toBeVisible();
      await page.getByRole('button', { name: 'Hell', exact: true }).click();
      await expect(page.locator('#settings-update')).toBeVisible();
    } else {
      // A waiting update is also found after reopening/reloading the app.
      await page.reload();
      await expect(page.locator('#update-banner')).toBeVisible();
      for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        expect(await page.locator('#update-banner').evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        })).toBe(true);
      }
    }
    // Everything needed for the new version has already been downloaded.
    await context.setOffline(true);
    const updateButton = page.locator(source === 'banner' ? '#update-now' : '#settings-update-now');
    await Promise.all([page.waitForEvent('load'), updateButton.click()]);
    await expect(page.locator('body')).toHaveAttribute('data-test-build', '2');
    await expect(page.locator('#update-banner')).toBeHidden();
    await expect(page.locator('#undo')).toBeEnabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solitaire:v1:game:classic-1')!).actions)).toEqual(saved.actions);
    await openSettings(page);
    await expect(page.locator('#settings-update')).toBeHidden();
    const keys = await page.evaluate(() => caches.keys());
    expect(keys).toContain('solitaire-test-2'); expect(keys).not.toContain('solitaire-test-1');
  });
}
test('an incomplete update leaves the current game and offline version intact', async ({ page, updateServer }) => {
  await installFirstVersion(page, updateServer.url);
  updateServer.version = 2; updateServer.failInstall = true;
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const finished = new Promise<string>(resolve => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing!;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'redundant' || worker.state === 'installed') resolve(worker.state);
        });
      }, { once: true });
    });
    await registration.update();
    return finished;
  });
  expect(state).toBe('redundant');
  await expect(page.locator('#update-banner')).toBeHidden();
  await page.locator('#stock').click(); await expect(page.locator('#undo')).toBeEnabled();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-test-build', '1');
});
