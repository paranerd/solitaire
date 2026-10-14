import { expect, test } from '@playwright/test';
import { createDeal, type Action, type Mode } from '../../src/game';
import type { Page } from '@playwright/test';

const modes: Mode[] = ['classic-1', 'classic-3', 'freecell', 'spider-1', 'spider-2', 'spider-4'];
async function openActions(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Spielaktionen ein-/ausklappen', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function seedGame(page: Page, seed: number, actions: Action[] = [], mode: Mode = 'classic-1'): Promise<void> {
  // Seed before the application starts: its pagehide handler correctly saves
  // the active game, so injecting into an already-running page is not stable.
  await page.addInitScript(({ seed, actions, mode }) => {
    if (!localStorage.getItem('solitaire:v1:mode')) localStorage.setItem('solitaire:v1:mode', JSON.stringify(mode));
    if (!localStorage.getItem('solitaire:v1:game:' + mode)) {
      localStorage.setItem('solitaire:v1:game:' + mode, JSON.stringify({ version: 1, seed, actions, elapsed: actions.length ? 70 : 0, started: actions.length > 0, recorded: false }));
      localStorage.setItem('solitaire:v1:stats:' + mode, JSON.stringify({ played: actions.length ? 1 : 0, wins: 0, bestTime: null, bestMoves: null, streak: 0, bestStreak: 0 }));
    }
  }, { seed, actions, mode });
  await page.goto('./');
}
for (const mode of ['classic-1', 'classic-3'] as const) {
  test(`${mode}: a real double-click moves an eligible tableau card to its foundation`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const deal = createDeal(mode, 9);
    await seedGame(page, deal.board.seed, [], mode);
    const action = deal.solution[0]; if (action.type !== 'move') throw new Error('expected initial tableau move');
    await page.locator(`#tableau [data-card="${action.card}"]`).dblclick();
    await expect(page.locator(`.upper [data-card="${action.card}"]`)).toHaveCount(1);
    await expect(page.locator('#metrics')).toContainText('1');
    await openActions(page);
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    await expect(page.locator(`#tableau [data-card="${action.card}"]`)).toHaveCount(1);
  });
  test(`${mode}: double-clicking an ineligible card does not move it`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const deal = createDeal(mode, 9);
    const card = deal.board.tableau.map(p => p.at(-1)!).find(c => c.rank > 1)!;
    await seedGame(page, deal.board.seed, [], mode);
    await page.locator(`#tableau [data-card="${card.id}"]`).dblclick();
    await expect(page.locator(`#tableau [data-card="${card.id}"]`)).toHaveCount(1);
    await expect(page.locator('.upper [data-card]')).toHaveCount(0);
    await expect(page.locator('#undo')).toBeDisabled();
  });
  test(`${mode}: double-click moves the top waste card and can be undone`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const deal = createDeal(mode, 9);
    const index = deal.solution.findIndex(a => a.type === 'move' && a.from.zone === 'waste');
    const action = deal.solution[index]; if (action.type !== 'move') throw new Error('expected waste move');
    await seedGame(page, deal.board.seed, deal.solution.slice(0, index), mode);
    await page.locator(`.waste-stack [data-card="${action.card}"]`).dblclick();
    await expect(page.locator(`.single-stack [data-zone="foundation"][data-card="${action.card}"]`)).toHaveCount(1);
    await openActions(page);
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    await expect(page.locator(`.waste-stack [data-card="${action.card}"]`)).toHaveCount(1);
  });
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
      await openActions(page);
      const fits = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        cards: [...document.querySelectorAll('.card,.action-menu,.tools,.tools .tool')].every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }),
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
  await openActions(page);
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
  await openActions(page);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator(`#tableau [data-card="${action.card}"]`)).toHaveCount(1);
  await page.reload();
  await expect(page.locator(`#tableau [data-card="${action.card}"]`)).toHaveCount(1);
});
test('drag moves a card and hint highlights its source', async ({ page }) => {
  const deal = createDeal('classic-1', 9); const action = deal.solution[0];
  if (action.type !== 'move') throw new Error('test seed must start with a move');
  await seedGame(page, deal.board.seed);
  await openActions(page);
  await page.getByRole('button', { name: 'Zughinweis', exact: true }).click();
  await expect(page.locator(`[data-card="${action.card}"]`)).toHaveClass(/hinted/);
  await expect(page.locator('#actions')).toBeHidden();
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
  await expect(page.locator('#help-tip')).toHaveCount(0);
  await openActions(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Zeit anzeigen' }).uncheck();
  await page.getByRole('switch', { name: 'Züge anzeigen' }).uncheck();
  await page.getByRole('switch', { name: 'Punkte anzeigen' }).uncheck();
  await page.getByRole('button', { name: 'Hell', exact: true }).click();
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('#metrics')).toHaveText('');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); await expect(page.locator('#metrics')).toHaveText('');
  await openActions(page);
  await page.getByRole('navigation', { name: 'Spielaktionen' }).getByRole('button', { name: 'Statistik', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deine kleinen Erfolge.' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück zum Spiel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
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
    await openActions(page);
    await page.getByRole('button', { name: 'Zughinweis', exact: true }).click(); await expect(page.locator('.hinted').first()).toBeVisible();
  }
});

test('game info has no action and the menu closes after actions, outside clicks, Escape, and toggling', async ({ page }) => {
  await seedGame(page, 9);
  await page.locator('#game-label').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.game-info button')).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Spielaktionen ein-/ausklappen', exact: true });
  const actions = page.getByRole('navigation', { name: 'Spielaktionen' });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(actions).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(actions.getByRole('button')).toHaveCount(5);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Zurück zum Spiel', exact: true }).click();
  await expect(actions).toBeHidden();
  await openActions(page);
  await page.getByRole('button', { name: 'Zughinweis', exact: true }).click();
  await expect(actions).toBeHidden();
  await expect(page.locator('.hinted').first()).toBeVisible();
  await openActions(page); await page.locator('#metrics').click();
  await expect(actions).toBeHidden();
  await openActions(page); await page.keyboard.press('Escape');
  await expect(actions).toBeHidden(); await expect(toggle).toBeFocused();
  await openActions(page); await toggle.click();
  await expect(actions).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test.describe('small touchscreens', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });
  test.skip(({ browserName }) => browserName === 'firefox', 'Playwright desktop Firefox cannot emulate a touchscreen.');
  for (const mode of ['classic-1', 'classic-3', 'freecell'] as const) {
    test(`${mode}: double-tap moves a tableau card exactly once and supports undo`, async ({ page }) => {
      const deal = createDeal(mode, 9);
      const action = deal.solution[0]; if (action.type !== 'move') throw new Error('expected tableau move');
      await seedGame(page, 9, [], mode);
      const card = page.locator(`#tableau [data-card="${action.card}"]`);
      await card.tap(); await expect(card).toHaveClass(/selected/);
      await card.tap();
      await expect(page.locator(`.upper [data-zone="foundation"][data-card="${action.card}"]`)).toHaveCount(1);
      expect(await page.evaluate(mode => JSON.parse(localStorage.getItem('solitaire:v1:game:' + mode)!).actions.length, mode)).toBe(1);
      await openActions(page); await page.getByRole('button', { name: 'Rückgängig', exact: true }).tap();
      await expect(card).toHaveCount(1); await expect(page.locator('#actions')).toBeHidden();
    });
  }
  for (const mode of ['classic-1', 'classic-3'] as const) {
    test(`${mode}: double-tap moves the top waste card`, async ({ page }) => {
      const deal = createDeal(mode, 9);
      const index = deal.solution.findIndex(a => a.type === 'move' && a.from.zone === 'waste');
      const action = deal.solution[index]; if (action.type !== 'move') throw new Error('expected waste move');
      await seedGame(page, 9, deal.solution.slice(0, index), mode);
      const card = page.locator(`.waste-stack [data-card="${action.card}"]`);
      await card.tap(); await card.tap();
      await expect(page.locator(`.upper [data-zone="foundation"][data-card="${action.card}"]`)).toHaveCount(1);
      expect(await page.evaluate(mode => JSON.parse(localStorage.getItem('solitaire:v1:game:' + mode)!).actions.length, mode)).toBe(index + 1);
    });
  }
  test('slow taps and double-tapping an ineligible card do not send cards to a foundation', async ({ page }) => {
    const deal = createDeal('classic-1', 9);
    const action = deal.solution[0]; if (action.type !== 'move') throw new Error('expected initial move');
    await seedGame(page, 9);
    const ace = page.locator(`#tableau [data-card="${action.card}"]`);
    await ace.tap(); await page.waitForTimeout(500); await ace.tap();
    await expect(ace).not.toHaveClass(/selected/);
    await expect(page.locator('.upper [data-zone="foundation"][data-card]')).toHaveCount(0);
    const ineligible = deal.board.tableau.map(p => p.at(-1)!).find(c => c.rank > 1)!;
    const card = page.locator(`#tableau [data-card="${ineligible.id}"]`);
    await card.tap(); await card.tap();
    await expect(card).toHaveCount(1);
    await expect(page.locator('#undo')).toBeDisabled();
  });
});
