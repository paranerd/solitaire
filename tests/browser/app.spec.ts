import { expect, test } from '@playwright/test';
import { createDeal, type Action, type Mode } from '../../src/game';
import type { Page } from '@playwright/test';

const modes: Mode[] = ['classic-1', 'classic-3', 'freecell', 'spider-1', 'spider-2', 'spider-4'];
async function seedGame(page: Page, seed: number, actions: Action[] = []): Promise<void> {
  // Seed before the application starts: its pagehide handler correctly saves
  // the active game, so injecting into an already-running page is not stable.
  await page.addInitScript(({ seed, actions }) => {
    if (!localStorage.getItem('solitaire:v1:game:classic-1')) {
      localStorage.setItem('solitaire:v1:game:classic-1', JSON.stringify({ version: 1, seed, actions, elapsed: actions.length ? 70 : 0, started: actions.length > 0, recorded: false }));
      localStorage.setItem('solitaire:v1:stats:classic-1', JSON.stringify({ played: actions.length ? 1 : 0, wins: 0, bestTime: null, bestMoves: null, streak: 0, bestStreak: 0 }));
    }
  }, { seed, actions });
  await page.goto('./');
}
test('all variants fit portrait, landscape, and desktop without scrolling', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const mode of modes) {
      await page.goto('./');
      await page.evaluate(m => { localStorage.setItem('solitaire:v1:mode', JSON.stringify(m)); }, mode);
      await page.reload();
      await expect(page.locator('.column')).toHaveCount(mode.startsWith('spider') ? 10 : mode === 'freecell' ? 8 : 7);
      const fits = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        cards: [...document.querySelectorAll('.card,.tools')].every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }),
      }));
      expect(fits.width).toBe(viewport.width); expect(fits.height).toBe(viewport.height); expect(fits.cards).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
test('Spider remains usable after all five deals and undo restores its stock', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('solitaire:v1:mode', JSON.stringify('spider-4')));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  for (let i = 0; i < 5; i++) await page.locator('#stock').click();
  await expect(page.locator('#tableau .card')).toHaveCount(104);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#tableau .card')].every(el => el.getBoundingClientRect().bottom <= document.querySelector('#board')!.getBoundingClientRect().bottom + 1))).toBe(true);
  }
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('#tableau .card')).toHaveCount(94);
  await expect(page.locator('#stock .stock-count')).toHaveText('1');
});
test('phone touchscreen can select and place a card', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Playwright desktop Firefox does not emulate a touch screen.');
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 }, baseURL: 'http://127.0.0.1:4173/solitaire/' });
  try {
    const page = await context.newPage(); await seedGame(page, 9);
    const action = createDeal('classic-1', 9).solution[0]; if (action.type !== 'move') throw new Error('expected move');
    await page.locator(`[data-card="${action.card}"]`).tap();
    await expect(page.locator(`[data-card="${action.card}"]`)).toHaveClass(/selected/);
    await page.locator(`.upper button[data-zone="foundation"][data-pile="${action.to.pile}"]`).tap();
    await expect(page.locator(`.upper [data-card="${action.card}"]`)).toHaveCount(1);
  } finally { await context.close(); }
});
test('tap moves, undo, save, and reload restore a real game', async ({ page }) => {
  const deal = createDeal('classic-1', 9);
  await seedGame(page, deal.board.seed);
  const action = deal.solution[0];
  if (action.type !== 'move') throw new Error('test seed must start with a move');
  await page.locator(`[data-card="${action.card}"]`).click();
  await expect(page.locator(`[data-card="${action.card}"]`)).toHaveClass(/selected/);
  await page.locator(`.upper [data-zone="foundation"][data-pile="${action.to.pile}"]`).click();
  await expect(page.locator('#metrics')).toContainText('1');
  await page.reload();
  await expect(page.locator(`.upper [data-card="${action.card}"]`)).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator(`#tableau [data-card="${action.card}"]`)).toHaveCount(1);
  await page.reload();
  await expect(page.locator(`#tableau [data-card="${action.card}"]`)).toHaveCount(1);
});
test('drag moves a card and hint highlights its source', async ({ page }) => {
  const deal = createDeal('classic-1', 9); const action = deal.solution[0];
  if (action.type !== 'move') throw new Error('test seed must start with a move');
  await seedGame(page, deal.board.seed);
  await page.getByRole('button', { name: 'Zughinweis', exact: true }).click();
  await expect(page.locator(`[data-card="${action.card}"]`)).toHaveClass(/hinted/);
  const source = await page.locator(`[data-card="${action.card}"]`).boundingBox();
  const target = await page.locator(`.upper [data-zone="foundation"][data-pile="${action.to.pile}"]`).boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator(`.upper [data-card="${action.card}"]`)).toHaveCount(1);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
});
test('settings persist; automatic theme follows system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Menü', exact: true }).click(); await page.getByRole('button', { name: /Einstellungen/ }).click();
  await page.getByRole('switch', { name: 'Zeit anzeigen' }).uncheck();
  await page.getByRole('switch', { name: 'Züge anzeigen' }).uncheck();
  await page.getByRole('switch', { name: 'Punkte anzeigen' }).uncheck();
  await page.getByRole('button', { name: 'Hell', exact: true }).click();
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('#metrics')).toHaveText('');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); await expect(page.locator('#metrics')).toHaveText('');
});
test('completion records a win exactly once and shows statistics', async ({ page }) => {
  const deal = createDeal('classic-1', 9); const actions = deal.solution.slice(0, -1); const final = deal.solution.at(-1)!;
  await seedGame(page, deal.board.seed, actions);
  if (final.type !== 'move') throw new Error('final must be a move');
  await page.locator(`[data-card="${final.card}"]`).click();
  await page.locator(`.upper button[data-zone="foundation"][data-pile="${final.to.pile}"]`).click();
  await expect(page.getByRole('heading', { name: 'Gut gespielt.' })).toBeVisible();
  const wins = await page.evaluate(() => JSON.parse(localStorage.getItem('solitaire:v1:stats:classic-1')!).wins); expect(wins).toBe(1);
  await page.reload(); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solitaire:v1:stats:classic-1')!).wins)).toBe(1);
});
test('PWA caches every asset, reloads offline and opens every game offline', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const assets = await page.evaluate(async () => { const keys = await caches.keys(); const cache = await caches.open(keys.find(k => k.startsWith('solitaire-'))!); return (await cache.keys()).map(r => r.url); });
  expect(assets.some(a => a.endsWith('icon-192.png'))).toBe(true); expect(assets.some(a => a.endsWith('icon-512.png'))).toBe(true);
  await context.setOffline(true);
  for (const mode of modes) {
    await page.evaluate(m => localStorage.setItem('solitaire:v1:mode', JSON.stringify(m)), mode); await page.reload();
    await expect(page.locator('.column')).toHaveCount(mode.startsWith('spider') ? 10 : mode === 'freecell' ? 8 : 7);
    await page.getByRole('button', { name: 'Zughinweis', exact: true }).click(); await expect(page.locator('.hinted').first()).toBeVisible();
  }
});
