import './style.scss';
import { apply, autoFinishAction, canMove, equalAction, isRed, isSpider, legalActions, modeNames, movableRun, pileAt,
  rankLabel, rankNames, suits, suitNames, top, won, type Action, type Card, type Mode, type Slot } from './game';
import { abandonStats, freshSession, loadMode, loadSession, loadSettings, loadStats, replay, saveMode,
  saveSession, saveSettings, startStats, storageUnavailable, winStats } from './storage';

const app = document.querySelector<HTMLElement>('#app')!;
const icons: Record<string, string> = {
  hamburger: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  undo: '<path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  hint: '<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.7-1.5 3.5h-4c0-1.8-.6-2.8-1.5-3.5Z"/>',
  settings: '<path d="m9 3-.6 2.4-1.8 1L4.2 6 2.7 8.6l1.8 1.7v2.1l-1.8 1.7 1.5 2.6 2.4-.7 1.8 1L9 20h3l.6-2.4 1.8-1 2.4.7 1.5-2.6-1.8-1.7v-2.1l1.8-1.7L16.8 6l-2.4.5-1.8-1L12 3Z" transform="translate(1.5 .5)"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  stats: '<path d="M5 20V12M12 20V5M19 20V9"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  auto: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.settings}</svg>`;
const modes = Object.keys(modeNames) as Mode[];
const settings = loadSettings();
let session = loadSession(loadMode());
let selected: { slot: Slot; card: string } | null = null;
let hintAction: Action | null = null;
let autoRunning = false;
let animationVersion = 0;
let offlineReady = false;
let workerRegistration: ServiceWorkerRegistration | null = null;
let pendingUpdate: ServiceWorker | null = null;
let deferredUpdate: ServiceWorker | null = null;
let updating = false;
let updateTimer = 0;
let installPrompt: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
let cardWidth = 90, cardHeight = 130, tableauHeight = 350;
let clockLast = performance.now();
let lastSave = clockLast;
let noticeTimer = 0;

app.innerHTML = `
  <div class="game-info"><span class="game-mark" aria-hidden="true">♠</span><button id="game-label" aria-label="Spielart wechseln"></button></div>
  <div id="metrics" class="metrics" aria-label="Spielinformationen"></div>
  <div id="board" class="board"><div id="layout" class="layout"><div id="upper" class="upper"></div><div id="tableau" class="tableau"></div></div></div>
  <div class="action-menu">
    <button id="actions-toggle" class="tool" aria-label="Spielaktionen ein-/ausklappen" title="Spielaktionen" aria-expanded="false" aria-controls="actions">${icon('hamburger')}</button>
    <nav id="actions" class="tools" aria-label="Spielaktionen" hidden>
      <button id="new" class="tool" aria-label="Neue Partie" title="Neue Partie (N)">${icon('plus')}</button>
      <span class="tool-divider"></span>
      <button id="undo" class="tool" aria-label="Rückgängig" title="Rückgängig (Strg/⌘ Z)">${icon('undo')}</button>
      <button id="hint" class="tool" aria-label="Zughinweis" title="Zughinweis (H)">${icon('hint')}</button>
      <span class="tool-divider"></span>
      <button id="stats" class="tool" aria-label="Statistik" title="Statistik">${icon('stats')}</button>
      <button id="menu" class="tool" aria-label="Einstellungen" title="Einstellungen">${icon('settings')}</button>
    </nav>
  </div>
  <button id="auto" class="auto-finish" hidden>${icon('auto')} Fertigspielen</button>
  <section id="update-banner" class="update-banner" aria-label="App-Update" hidden>
    <p role="status">Eine neue Version ist verfügbar.</p>
    <div class="update-actions"><button id="update-now" class="primary">Jetzt aktualisieren</button><button id="update-later" class="text-button">Später</button></div>
  </section>
  <div id="notice" class="notice" role="status" aria-live="polite"></div>
  <dialog id="dialog" aria-labelledby="dialog-title"><div id="dialog-content"></div></dialog>
  <div id="live" class="sr-only" role="status" aria-live="polite"></div>`;
const boardElement = document.querySelector<HTMLElement>('#board')!;
const layout = document.querySelector<HTMLElement>('#layout')!;
const upper = document.querySelector<HTMLElement>('#upper')!;
const tableau = document.querySelector<HTMLElement>('#tableau')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const content = document.querySelector<HTMLElement>('#dialog-content')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const button = (id: string) => document.querySelector<HTMLButtonElement>('#' + id)!;
button('actions-toggle').addEventListener('click', () => {
  const actions = document.querySelector<HTMLElement>('#actions')!;
  actions.hidden = !actions.hidden;
  button('actions-toggle').setAttribute('aria-expanded', String(!actions.hidden));
});
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const timeLabel = (seconds: number) => { const s = Math.floor(seconds); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; };
function announce(message: string): void { document.querySelector<HTMLElement>('#live')!.textContent = message; }
function toast(message: string): void {
  clearTimeout(noticeTimer); notice.textContent = message; notice.classList.add('visible');
  noticeTimer = window.setTimeout(() => notice.classList.remove('visible'), 3800);
}
function renderUpdate(): void {
  document.querySelector<HTMLElement>('#update-banner')!.hidden = !pendingUpdate || deferredUpdate === pendingUpdate;
  button('update-now').disabled = updating;
  button('update-now').textContent = updating ? 'Wird aktualisiert …' : 'Jetzt aktualisieren';
  button('update-later').disabled = updating;
  const settingsUpdate = content.querySelector<HTMLElement>('#settings-update');
  if (settingsUpdate) {
    settingsUpdate.hidden = !pendingUpdate;
    const updateButton = settingsUpdate.querySelector<HTMLButtonElement>('button')!;
    updateButton.disabled = updating;
    updateButton.textContent = updating ? 'Wird aktualisiert …' : 'Jetzt aktualisieren';
  }
}
function detectUpdate(): void {
  const waiting = workerRegistration?.waiting ?? null;
  if (waiting !== pendingUpdate) {
    pendingUpdate = waiting; updating = false; clearTimeout(updateTimer);
  }
  renderUpdate();
}
function applyUpdate(): void {
  detectUpdate();
  if (!pendingUpdate || updating) return;
  advanceClock(); saveSession(session);
  updating = true; renderUpdate();
  pendingUpdate.postMessage({ type: 'SKIP_WAITING' });
  updateTimer = window.setTimeout(() => {
    updating = false; renderUpdate();
    toast('Das Update konnte nicht abgeschlossen werden. Bitte versuche es erneut.');
  }, 15000);
}
button('update-now').addEventListener('click', applyUpdate);
button('update-later').addEventListener('click', () => { deferredUpdate = pendingUpdate; renderUpdate(); });
function checkForUpdate(): void {
  if (navigator.onLine && workerRegistration && !workerRegistration.installing) void workerRegistration.update().catch(() => {});
}
function setTheme(): void {
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.motion = settings.animations ? 'on' : 'off';
  document.querySelector('meta[name="theme-color"]')!.setAttribute('content', dark ? '#172721' : '#e9eee8');
}
function slotAttrs(slot: Slot): string { return `data-zone="${slot.zone}" data-pile="${slot.pile}"`; }
function slotFrom(element: HTMLElement): Slot { return { zone: element.dataset.zone as Slot['zone'], pile: Number(element.dataset.pile) }; }
function cardMarkup(card: Card, slot: Slot, offset = 0): string {
  const movable = movableRun(session.board, slot, card.id).length > 0;
  const isSelected = selected?.card === card.id;
  const hint = hintAction?.type === 'move' && hintAction.card === card.id;
  return `<button class="card ${card.up ? 'face' : 'back'} ${isRed(card) ? 'red' : 'black'} ${isSelected ? 'selected' : ''} ${hint ? 'hinted' : ''}"
    ${slotAttrs(slot)} data-card="${card.id}" data-up="${card.up}" style="--offset:${offset}px" tabindex="${movable ? 0 : -1}"
    aria-label="${card.up ? `${rankNames[card.rank]} ${suitNames[card.suit]}` : 'Verdeckte Karte'}" aria-pressed="${isSelected}">
    ${card.up ? `<span class="corner"><b>${rankLabel(card.rank)}</b><i>${suits[card.suit]}</i></span><span class="pip">${suits[card.suit]}</span><span class="corner lower"><b>${rankLabel(card.rank)}</b><i>${suits[card.suit]}</i></span>` : '<span class="back-pattern" aria-hidden="true">♠</span>'}
  </button>`;
}
function emptySlot(slot: Slot, label: string, mark = '', extra = ''): string {
  const targetHint = hintAction?.type === 'move' && hintAction.to.zone === slot.zone && hintAction.to.pile === slot.pile;
  return `<button class="placeholder ${extra} ${targetHint ? 'hinted' : ''}" ${slotAttrs(slot)} aria-label="${label}"><span aria-hidden="true">${mark}</span></button>`;
}
function stackMarkup(slot: Slot, mark = ''): string {
  const pile = pileAt(session.board, slot);
  if (!pile.length) return emptySlot(slot, `${slot.zone === 'cell' ? 'Freie Zelle' : 'Ablage'} ${slot.pile + 1}`, mark);
  return `<div class="single-stack" ${slotAttrs(slot)}>${cardMarkup(top(pile)!, slot)}</div>`;
}
function stockMarkup(): string {
  const spider = isSpider(session.board.mode);
  const count = spider ? session.board.stock.length / 10 : session.board.stock.length;
  const active = canMove(session.board, { type: 'draw' });
  const hint = hintAction?.type === 'draw';
  const label = spider ? `${count} Kartenreihen im Vorrat. Neue Reihe austeilen` : count ? `${count} Karten im Talon. Karte ziehen` : 'Talon erneut durchgehen';
  return `<button id="stock" class="stock ${count ? 'has-cards' : ''} ${hint ? 'hinted' : ''}" aria-label="${label}" ${!active ? 'aria-disabled="true"' : ''}>
    ${count ? `<span class="stock-back"><span class="back-pattern" aria-hidden="true">♠</span></span><span class="stock-count">${count}</span>` : '<span class="recycle" aria-hidden="true">↻</span>'}
  </button>`;
}
function render(animate = true): void {
  const previous = new Map<string, { rect: DOMRect; up: string | undefined; element: HTMLElement }>();
  if (animate && motionAllowed()) for (const el of layout.querySelectorAll<HTMLElement>('.card')) previous.set(el.dataset.card!, { rect: el.getBoundingClientRect(), up: el.dataset.up, element: el.cloneNode(true) as HTMLElement });
  const focused = document.activeElement as HTMLElement | null;
  const focusedCard = focused?.dataset.card;
  const mode = session.board.mode;
  const spider = isSpider(mode);
  const count = session.board.tableau.length;
  layout.style.setProperty('--columns', String(count));
  layout.dataset.game = spider ? 'spider' : mode === 'freecell' ? 'freecell' : 'classic';
  if (mode === 'freecell') {
    upper.innerHTML = session.board.cells.map((_, pile) => stackMarkup({ zone: 'cell', pile }, '◇')).join('') +
      session.board.foundation.map((_, pile) => stackMarkup({ zone: 'foundation', pile }, suits[pile])).join('');
  } else if (spider) {
    upper.innerHTML = session.board.foundation.map((p, pile) => `<div class="completed ${p.length ? 'filled' : ''}" aria-label="${p.length ? 'Vollständige' : 'Leere'} Sequenz ${pile + 1}"><span aria-hidden="true">${p.length ? suits[p[0].suit] : '·'}</span>${p.length ? '<small>K–A</small>' : ''}</div>`).join('') + '<div></div>' + stockMarkup();
  } else {
    const visibleWaste = session.board.mode === 'classic-3' ? session.board.waste.slice(-3) : session.board.waste.slice(-1);
    const waste = visibleWaste.length ? `<div class="waste-stack" ${slotAttrs({ zone: 'waste', pile: 0 })}>${visibleWaste.map((c, i) => cardMarkup(c, { zone: 'waste', pile: 0 }, 0).replace('style="', `style="--fan:${i * Math.min(12, cardWidth * .13)}px;`)).join('')}</div>` : emptySlot({ zone: 'waste', pile: 0 }, 'Leerer Abwurf');
    upper.innerHTML = stockMarkup() + waste + '<div></div>' + session.board.foundation.map((_, pile) => stackMarkup({ zone: 'foundation', pile }, suits[pile])).join('');
  }
  tableau.innerHTML = session.board.tableau.map((pile, col) => {
    const slot: Slot = { zone: 'tableau', pile: col };
    const hiddenStep = Math.max(5, cardWidth * .16), faceStep = Math.max(10, cardWidth * .30);
    const raw = pile.slice(0, -1).reduce((n, c) => n + (c.up ? faceStep : hiddenStep), 0);
    const scale = raw ? Math.min(1, Math.max(0, tableauHeight - cardHeight) / raw) : 1;
    let y = 0;
    const cards = pile.map((card, i) => { const html = cardMarkup(card, slot, y); if (i < pile.length - 1) y += (card.up ? faceStep : hiddenStep) * scale; return html; }).join('');
    return `<div class="column" ${slotAttrs(slot)}>${emptySlot(slot, `Leere Spalte ${col + 1}`, session.board.mode.startsWith('classic') ? 'K' : '')}${cards}</div>`;
  }).join('');
  button('game-label').innerHTML = `<span>${mode === 'freecell' ? 'FreeCell' : spider ? 'Spider' : 'Classic'}</span>`;
  button('undo').disabled = !session.actions.length || autoRunning;
  button('hint').disabled = won(session.board) || autoRunning;
  button('new').disabled = autoRunning;
  button('auto').hidden = !autoFinishAction(session.board) || won(session.board);
  button('auto').disabled = autoRunning;
  renderMetrics();
  if (focusedCard) layout.querySelector<HTMLElement>(`[data-card="${focusedCard}"]`)?.focus({ preventScroll: true });
  const version = ++animationVersion;
  if (previous.size) requestAnimationFrame(() => {
    if (version !== animationVersion) return;
    for (const el of layout.querySelectorAll<HTMLElement>('.card')) {
      const old = previous.get(el.dataset.card!); if (!old) continue;
      const now = el.getBoundingClientRect();
      const dx = old.rect.x - now.x, dy = old.rect.y - now.y;
      if (dx || dy) { el.style.zIndex = '150'; el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.then(() => { el.style.zIndex = ''; }).catch(() => {}); }
      if (old.up !== el.dataset.up) el.animate([{ transform: 'scaleX(0.05)', opacity: .6 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
    }
    if (isSpider(session.board.mode)) {
      for (const [id, old] of previous) {
        if (layout.querySelector(`[data-card="${id}"]`)) continue;
        const completed = session.board.foundation.findIndex(p => p.some(c => c.id === id));
        if (completed < 0) continue;
        const target = upper.querySelectorAll('.completed')[completed].getBoundingClientRect();
        const ghost = old.element; ghost.classList.add('drag-ghost'); ghost.classList.remove('selected', 'hinted'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
        ghost.style.cssText = `--card-w:${cardWidth}px;--card-h:${cardHeight}px;--offset:0px;left:${old.rect.x}px;top:${old.rect.y}px;`;
        document.body.append(ghost);
        ghost.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${target.x - old.rect.x}px,${target.y - old.rect.y}px) scale(.65)`, opacity: 0 }], { duration: 340, easing: 'ease-in-out' }).finished.then(() => ghost.remove()).catch(() => ghost.remove());
      }
    }
  });
}
function motionAllowed(): boolean { return settings.animations && !matchMedia('(prefers-reduced-motion: reduce)').matches; }
function renderMetrics(): void {
  document.querySelector<HTMLElement>('#metrics')!.innerHTML = [
    settings.time ? `<span><b>${timeLabel(session.elapsed)}</b><small>Zeit</small></span>` : '',
    settings.moves ? `<span><b>${session.board.moves}</b><small>Züge</small></span>` : '',
    settings.score ? `<span><b>${session.board.score}</b><small>Punkte</small></span>` : '',
  ].join('');
}
function resize(): void {
  const rect = boardElement.getBoundingClientRect();
  const count = session.board.tableau.length;
  const gap = rect.width < 480 ? 4 : rect.width < 800 ? 8 : 14;
  cardWidth = Math.floor(Math.min(112, (rect.width - (count - 1) * gap) / count, rect.height * .21));
  cardHeight = Math.round(cardWidth * 1.45);
  const rowGap = Math.min(30, rect.height * .055);
  tableauHeight = rect.height - cardHeight - rowGap;
  layout.style.setProperty('--card-w', cardWidth + 'px');
  layout.style.setProperty('--card-h', cardHeight + 'px');
  layout.style.setProperty('--gap', gap + 'px');
  layout.style.setProperty('--row-gap', rowGap + 'px');
  layout.style.setProperty('--tableau-h', tableauHeight + 'px');
  layout.style.width = `${count * cardWidth + (count - 1) * gap}px`;
  render(false);
}
function perform(action: Action): boolean {
  if (dialog.open && !won(session.board)) return false;
  const next = apply(session.board, action);
  if (!next) return false;
  advanceClock();
  startStats(session);
  if (session.guide !== null) session.guide = session.deal.solution[session.guide] && equalAction(action, session.deal.solution[session.guide]) ? session.guide + 1 : null;
  session.board = next; session.actions.push(action); selected = null; hintAction = null;
  clockLast = performance.now();
  saveSession(session); render();
  announce(action.type === 'draw' ? 'Karten ausgeteilt.' : `Karte auf ${action.to.zone === 'foundation' ? 'Ablage' : action.to.zone === 'cell' ? 'freie Zelle' : 'Spalte'} ${action.to.pile + 1} gelegt.`);
  if (won(next)) {
    winStats(session); saveSession(session);
    window.setTimeout(() => { if (won(session.board)) showWin(); }, motionAllowed() ? 380 : 0);
  }
  return true;
}
function pickOrMove(element: HTMLElement): void {
  if (autoRunning) return;
  if (element.closest('#stock')) {
    if (!perform({ type: 'draw' }) && isSpider(session.board.mode) && session.board.stock.length) toast('Vor dem Austeilen muss jede Spalte mindestens eine Karte enthalten.');
    return;
  }
  const target = element.closest<HTMLElement>('[data-zone]'); if (!target) return;
  const slot = slotFrom(target);
  if (selected && (selected.slot.zone !== slot.zone || selected.slot.pile !== slot.pile)) {
    if (perform({ type: 'move', from: selected.slot, to: slot, card: selected.card })) return;
  }
  const cardId = target.dataset.card;
  if (cardId && movableRun(session.board, slot, cardId).length) {
    selected = selected?.card === cardId ? null : { slot, card: cardId };
    hintAction = null; updateSelection();
  } else { selected = null; hintAction = null; updateSelection(); }
}
function updateSelection(): void {
  // Keep the clicked element in place so the browser can recognize a double-click.
  for (const el of layout.querySelectorAll('.hinted')) el.classList.remove('hinted');
  for (const el of layout.querySelectorAll<HTMLElement>('.card')) {
    const active = selected?.card === el.dataset.card;
    el.classList.toggle('selected', active);
    el.setAttribute('aria-pressed', String(active));
  }
}
layout.addEventListener('click', e => { if (!suppressClick) pickOrMove(e.target as HTMLElement); });
layout.addEventListener('dblclick', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-card]'); if (!el || autoRunning) return;
  const from = slotFrom(el);
  const card = pileAt(session.board, from).find(c => c.id === el.dataset.card); if (!card) return;
  perform({ type: 'move', from, to: { zone: 'foundation', pile: card.suit }, card: card.id });
});
let suppressClick = false;
let drag: { id: number; startX: number; startY: number; x: number; y: number; slot: Slot; card: string; ghosts: HTMLElement[]; active: boolean; rect: DOMRect; cards: Card[] } | null = null;
layout.addEventListener('pointerdown', e => {
  if (e.button !== 0 || autoRunning || dialog.open) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-card]'); if (!el) return;
  const slot = slotFrom(el), cards = movableRun(session.board, slot, el.dataset.card!); if (!cards.length) return;
  drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, slot, card: el.dataset.card!, ghosts: [], active: false, rect: el.getBoundingClientRect(), cards };
  el.setPointerCapture(e.pointerId);
});
layout.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
    drag.active = true; selected = null; hintAction = null;
    drag.cards.forEach(c => {
      const original = layout.querySelector<HTMLElement>(`[data-card="${c.id}"]`)!;
      const rect = original.getBoundingClientRect(); const ghost = original.cloneNode(true) as HTMLElement;
      ghost.classList.add('drag-ghost'); ghost.classList.remove('selected', 'hinted'); ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1;
      ghost.style.cssText = `--card-w:${cardWidth}px;--card-h:${cardHeight}px;--offset:0px;left:${rect.left}px;top:${rect.top}px;width:${cardWidth}px;height:${cardHeight}px;`;
      document.body.append(ghost); original.classList.add('drag-source'); drag!.ghosts.push(ghost);
    });
  }
  if (drag.active) {
    e.preventDefault();
    for (const ghost of drag.ghosts) ghost.style.transform = `translate(${e.clientX - drag.startX}px, ${e.clientY - drag.startY}px)`;
    for (const el of layout.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-zone]');
    if (under && canMove(session.board, { type: 'move', from: drag.slot, to: slotFrom(under), card: drag.card })) under.classList.add('drop-target');
  }
});
function endDrag(e: PointerEvent, cancelled = false): void {
  if (!drag || drag.id !== e.pointerId) return;
  const current = drag; drag = null;
  if (layout.hasPointerCapture(e.pointerId)) layout.releasePointerCapture(e.pointerId);
  current.ghosts.forEach(g => g.remove());
  layout.querySelectorAll('.drag-source,.drop-target').forEach(el => el.classList.remove('drag-source', 'drop-target'));
  if (current.active) {
    suppressClick = true; window.setTimeout(() => { suppressClick = false; }, 0);
    if (!cancelled) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-zone]');
      if (target) perform({ type: 'move', from: current.slot, to: slotFrom(target), card: current.card });
    }
  }
}
layout.addEventListener('pointerup', e => endDrag(e));
layout.addEventListener('pointercancel', e => endDrag(e, true));
button('undo').addEventListener('click', undo);
function undo(): void {
  if (!session.actions.length || autoRunning || dialog.open) return;
  session.actions.pop(); replay(session); selected = null; hintAction = null; saveSession(session); render(); announce('Letzten Zug rückgängig gemacht.');
}
button('hint').addEventListener('click', showHint);
function showHint(): void {
  if (autoRunning || dialog.open || won(session.board)) return;
  const available = legalActions(session.board);
  const planned = session.guide !== null ? session.deal.solution[session.guide] : undefined;
  const selectedMove = selected ? available.find(a => a.type === 'move' && a.card === selected!.card && a.to.zone === 'foundation') : undefined;
  const useful = available.filter(a => a.type === 'move' && (a.to.zone === 'foundation' || (a.from.zone === 'tableau' && pileAt(session.board, a.from).findIndex(c => c.id === a.card) > 0 && !pileAt(session.board, a.from)[pileAt(session.board, a.from).findIndex(c => c.id === a.card) - 1].up)));
  hintAction = planned && canMove(session.board, planned) ? planned : selectedMove ?? useful[0] ?? available.find(a => a.type === 'draw') ?? available[0] ?? null;
  selected = null; render(false);
  if (!hintAction) { toast('Kein legaler Zug. Versuche, einen Zug rückgängig zu machen.'); return; }
  if (hintAction.type === 'draw') toast(isSpider(session.board.mode) ? 'Teile die nächste Kartenreihe aus.' : 'Ziehe die nächste Karte aus dem Talon.');
  else {
    const card = pileAt(session.board, hintAction.from).find(c => c.id === (hintAction as Extract<Action, { type: 'move' }>).card)!;
    toast(`${rankNames[card.rank]} ${suitNames[card.suit]} → ${hintAction.to.zone === 'foundation' ? 'Ablage' : hintAction.to.zone === 'cell' ? 'freie Zelle' : 'Spalte'} ${hintAction.to.pile + 1}`);
  }
}
button('auto').addEventListener('click', async () => {
  if (autoRunning) return;
  autoRunning = true;
  try { for (let i = 0; i < 104; i++) { const action = autoFinishAction(session.board); if (!action || dialog.open) break; perform(action); await new Promise(resolve => setTimeout(resolve, motionAllowed() ? 110 : 0)); } }
  finally { autoRunning = false; render(false); }
});
function modal(title: string, body: string, eyebrow = 'SOLITAIRE'): void {
  advanceClock();
  content.innerHTML = `<div class="dialog-head"><div><p class="eyebrow">${eyebrow}</p><h1 id="dialog-title">${title}</h1></div><button class="icon-button close" aria-label="Schließen">${icon('close')}</button></div>${body}`;
  content.querySelector('.close')!.addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
dialog.addEventListener('close', () => { clockLast = performance.now(); });
button('new').addEventListener('click', () => showGames());
button('game-label').addEventListener('click', () => showGames());
button('menu').addEventListener('click', showSettings);
button('stats').addEventListener('click', () => showStats());
function showGames(chosen: Mode = session.board.mode): void {
  const group = chosen.startsWith('classic') ? 'classic' : chosen === 'freecell' ? 'freecell' : 'spider';
  modal('Was möchtest du spielen?', `<p class="dialog-intro">Drei Klassiker. Unendlich viele ruhige Momente.</p>
    <div class="game-choices">
      <button class="game-choice ${group === 'classic' ? 'active' : ''}" data-mode="classic-1"><span class="choice-symbol">♠</span><b>Classic</b><small>Der Klassiker</small></button>
      <button class="game-choice ${group === 'freecell' ? 'active' : ''}" data-mode="freecell"><span class="choice-symbol">◇</span><b>FreeCell</b><small>Alles liegt offen</small></button>
      <button class="game-choice ${group === 'spider' ? 'active' : ''}" data-mode="spider-1"><span class="choice-symbol spider-symbol">✳</span><b>Spider</b><small>Sequenzen sammeln</small></button>
    </div>
    ${group !== 'freecell' ? `<div class="option-line"><span>${group === 'classic' ? 'Karten ziehen' : 'Farben'}</span><div class="segments" role="group" aria-label="${group === 'classic' ? 'Karten ziehen' : 'Spider-Farben'}">${(group === 'classic' ? [1, 3] : [1, 2, 4]).map(n => `<button class="${chosen.endsWith(String(n)) ? 'active' : ''}" data-variant="${group}-${n}" aria-pressed="${chosen.endsWith(String(n))}">${n}</button>`).join('')}</div></div>` : '<p class="variant-note">52 Karten · 4 freie Zellen · 8 Spalten</p>'}
    <button class="primary wide" id="start-game">Neue Partie ${icon('arrow')}</button>
    ${chosen !== session.board.mode ? '<button class="secondary wide" id="resume-game">Gespeicherte Partie fortsetzen</button>' : '<button class="text-button wide" id="restart-game">Diese Austeilung von vorn</button>'}
    <button class="text-button wide" id="rules">Spielregeln ansehen</button>`);
  content.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(el => el.addEventListener('click', () => showGames(el.dataset.mode as Mode)));
  content.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach(el => el.addEventListener('click', () => showGames(el.dataset.variant as Mode)));
  content.querySelector('#start-game')!.addEventListener('click', () => confirmNew(chosen));
  content.querySelector('#restart-game')?.addEventListener('click', () => confirmNew(chosen, session.seed));
  content.querySelector('#resume-game')?.addEventListener('click', () => switchGame(chosen));
  content.querySelector('#rules')!.addEventListener('click', () => showRules(chosen));
}
function switchGame(mode: Mode, fresh = false, seed?: number): void {
  saveSession(session);
  if (fresh) abandonStats(mode === session.board.mode ? session : loadSession(mode));
  session = fresh ? freshSession(mode, seed) : loadSession(mode);
  saveMode(mode); saveSession(session); selected = null; hintAction = null; dialog.close(); clockLast = performance.now(); resize();
}
function confirmNew(mode: Mode, seed?: number): void {
  const previous = mode === session.board.mode ? session : loadSession(mode);
  if (!previous.started || won(previous.board)) { switchGame(mode, true, seed); return; }
  modal(seed === undefined ? 'Bereit für eine neue Partie?' : 'Noch einmal von vorn?', `<p class="dialog-intro">Der bisherige Spielstand für ${modeNames[mode]} wird ersetzt. Deine anderen Spielarten bleiben gespeichert.</p>
    <button class="primary wide" id="confirm-new">${seed === undefined ? 'Neue Partie starten' : 'Austeilung neu starten'} ${icon('arrow')}</button><button class="secondary wide" id="cancel-new">Zurück</button>`);
  content.querySelector('#confirm-new')!.addEventListener('click', () => switchGame(mode, true, seed));
  content.querySelector('#cancel-new')!.addEventListener('click', () => showGames(mode));
}
function showSettings(): void {
  modal('Einstellungen', `<p class="dialog-intro">Weniger Ablenkung. Mehr Spiel.</p>
    <div class="setting-row theme-row"><span>Darstellung</span><div class="segments" role="group" aria-label="Farbschema">${(['auto', 'light', 'dark'] as const).map((t, i) => `<button data-theme="${t}" class="${settings.theme === t ? 'active' : ''}" aria-pressed="${settings.theme === t}">${['Auto', 'Hell', 'Dunkel'][i]}</button>`).join('')}</div></div>
    <p class="section-label">AUF DEM SPIELFELD</p>
    ${(['time', 'moves', 'score', 'animations'] as const).map((key, i) => `<label class="setting-row"><span>${['Zeit anzeigen', 'Züge anzeigen', 'Punkte anzeigen', 'Animationen'][i]}</span><input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''} role="switch"><span class="switch" aria-hidden="true"></span></label>`).join('')}
    <section id="settings-update" class="settings-update" hidden><p>Eine neue Version ist verfügbar.</p><button class="secondary wide" id="settings-update-now">Jetzt aktualisieren</button></section>
    <p class="settings-note">Spielstände, Einstellungen und Statistik werden automatisch auf diesem Gerät gespeichert.</p>
    <div class="menu-note"><span class="status-dot"></span><span>${offlineReady ? 'Offline bereit' : navigator.onLine ? 'Offline-Modus wird vorbereitet' : 'Du spielst offline'} · Alles bleibt auf diesem Gerät</span></div>
    ${installPrompt ? `<button class="secondary wide" id="install">${icon('download')} App installieren</button>` : ''}
    <p class="keyboard-note">Tastatur: Tab & Enter · H für Hinweis · Strg/⌘ Z zurück</p>
    <button class="text-button wide" id="back-game">Zurück zum Spiel</button>`);
  content.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(el => el.addEventListener('click', () => { settings.theme = el.dataset.theme as typeof settings.theme; setTheme(); saveSettings(settings); showSettings(); }));
  content.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(el => el.addEventListener('change', () => { settings[el.dataset.setting as 'time' | 'moves' | 'score' | 'animations'] = el.checked; setTheme(); saveSettings(settings); renderMetrics(); }));
  content.querySelector('#settings-update-now')!.addEventListener('click', applyUpdate);
  renderUpdate();
  content.querySelector('#back-game')!.addEventListener('click', () => dialog.close());
  content.querySelector('#install')?.addEventListener('click', async () => { await installPrompt?.prompt(); await installPrompt?.userChoice; installPrompt = null; showSettings(); });
}
function showStats(mode: Mode = session.board.mode): void {
  const stats = loadStats(mode);
  modal('Deine kleinen Erfolge.', `<p class="dialog-intro">Ein Zug nach dem anderen.</p>
    <label class="select-label">Spielart<select id="stats-mode">${modes.map(m => `<option value="${m}" ${mode === m ? 'selected' : ''}>${modeNames[m]}</option>`).join('')}</select></label>
    <div class="stats-grid"><div><b>${stats.played}</b><span>Partien</span></div><div><b>${stats.wins}</b><span>Gewonnen</span></div><div><b>${stats.played ? Math.round(stats.wins / stats.played * 100) : 0}<small>%</small></b><span>Gewinnrate</span></div><div><b>${stats.bestTime === null ? '–' : timeLabel(stats.bestTime)}</b><span>Beste Zeit</span></div><div><b>${stats.bestMoves ?? '–'}</b><span>Wenigste Züge</span></div><div><b>${stats.bestStreak}</b><span>Beste Siegesserie</span></div></div>
    <p class="settings-note">Eine Partie zählt ab dem ersten Zug. Neustarts unterbrechen die Siegesserie. Die Zeit pausiert bei geöffneten Dialogen und wenn die App im Hintergrund ist.</p><button class="text-button wide" id="back-game">Zurück zum Spiel</button>`);
  content.querySelector<HTMLSelectElement>('#stats-mode')!.addEventListener('change', e => showStats((e.target as HTMLSelectElement).value as Mode));
  content.querySelector('#back-game')!.addEventListener('click', () => dialog.close());
}
function showRules(mode: Mode): void {
  const spider = isSpider(mode);
  const text = spider ? [
    'Baue absteigende Sequenzen vom König bis zum Ass. Auf eine Karte darf immer eine Karte mit dem nächstkleineren Wert – unabhängig von der Farbe.',
    'Zusammen bewegen kannst du nur absteigende Sequenzen derselben Farbe. Eine vollständige Sequenz derselben Farbe wird automatisch abgelegt. Sammle alle acht Sequenzen.',
    'Der Vorrat teilt eine Karte auf jede Spalte aus. Dafür muss jede Spalte belegt sein. Eine leere Spalte darf jede Karte oder bewegliche Sequenz aufnehmen.',
    'Punkte: Start mit 500, −1 pro Zug, +100 pro vollständiger Sequenz.',
  ] : mode === 'freecell' ? [
    'Lege alle Karten auf die vier Ablagen, jeweils nach Farbe vom Ass bis zum König.',
    'In den Spalten baust du absteigend und mit wechselnden roten und schwarzen Karten. Jede freie Zelle nimmt genau eine Karte auf. Leere Spalten nehmen jede Karte auf.',
    'Die Länge einer beweglichen Sequenz hängt von den verfügbaren freien Zellen und leeren Spalten ab: (freie Zellen + 1) × 2 hoch leere Hilfsspalten. Die Zielspalte zählt nicht als Hilfsspalte.',
    'Punkte: +10 pro Karte auf einer Ablage, −15 beim Zurücknehmen.',
  ] : [
    'Lege alle Karten auf die vier Ablagen, jeweils nach Farbe vom Ass bis zum König.',
    'In den Spalten baust du absteigend und abwechselnd rot und schwarz. Bewegliche Sequenzen können zusammen verschoben werden. Nur Könige oder Sequenzen mit einem König passen auf leere Spalten.',
    `Der Talon zieht ${mode === 'classic-3' ? 'drei Karten' : 'eine Karte'} auf einmal. Nur die oberste Karte des Abwurfs ist spielbar. Du kannst den Talon unbegrenzt erneut durchgehen.`,
    'Punkte: +10 auf die Ablage, +5 für eine aufgedeckte Karte oder vom Abwurf auf eine Spalte, −15 von der Ablage zurück, −20 für einen neuen Talon-Durchgang (mindestens 0).',
  ];
  modal(modeNames[mode], `<div class="rules">${text.map(t => `<p>${escape(t)}</p>`).join('')}<p>Karten ziehen oder zuerst eine Karte und dann ihr Ziel antippen. Ein Doppelklick legt eine passende Karte direkt auf die Ablage. Rückgängig stellt auch die Punkte wieder her. Hinweise zeigen einen legalen Zug; nach eigenen Abweichungen ist damit kein vollständiger Lösungsweg garantiert.</p><p>Alle Austeilungen werden konstruktiv mit einem vollständigen Lösungsweg erzeugt. Sie sind deshalb lösbar, aber nicht gleichverteilt zufällig.</p></div><button class="secondary wide" id="back-games">Zurück zur Spielauswahl</button>`, 'SPIELREGELN');
  content.querySelector('#back-games')!.addEventListener('click', () => showGames(mode));
}
function showWin(): void {
  modal('Gut gespielt.', `<div class="win-symbol" aria-hidden="true">♠</div><p class="win-copy">Alle Karten haben ihren Platz gefunden.<br>Ein schöner Moment für die nächste Partie.</p><div class="win-metrics"><span><b>${timeLabel(session.elapsed)}</b>Zeit</span><span><b>${session.board.moves}</b>Züge</span><span><b>${session.board.score}</b>Punkte</span></div><button class="primary wide" id="win-new">Noch eine Partie ${icon('arrow')}</button><button class="text-button wide" id="win-stats">Statistik ansehen</button>`, 'GEWONNEN');
  content.querySelector('#win-new')!.addEventListener('click', () => switchGame(session.board.mode, true));
  content.querySelector('#win-stats')!.addEventListener('click', () => showStats());
}
document.addEventListener('keydown', e => {
  if (dialog.open || ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); showHint(); }
  else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); showGames(); }
  else if (e.key === 'Escape') { selected = null; hintAction = null; render(false); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const focusable = [...layout.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])')];
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    focusable[(current + step + focusable.length) % focusable.length]?.focus({ preventScroll: true }); e.preventDefault();
  }
});
new ResizeObserver(resize).observe(boardElement);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setTheme);
document.addEventListener('visibilitychange', () => { clockLast = performance.now(); if (document.hidden) saveSession(session); });
window.addEventListener('pagehide', () => saveSession(session));
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e as typeof installPrompt; });
function advanceClock(): void {
  const now = performance.now();
  if (session.started && !won(session.board) && !document.hidden && !dialog.open) session.elapsed += (now - clockLast) / 1000;
  clockLast = now; renderMetrics();
}
setInterval(() => {
  advanceClock();
  const now = performance.now();
  if (now - lastSave > 5000) { saveSession(session); lastSave = now; }
}, 500);
setTheme(); resize();
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloading) return;
    reloading = true;
    advanceClock(); saveSession(session);
    window.location.reload();
  });
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then(async registration => {
    workerRegistration = registration;
    const watchInstalling = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', detectUpdate);
      detectUpdate();
    };
    registration.addEventListener('updatefound', watchInstalling);
    watchInstalling();
    await navigator.serviceWorker.ready; offlineReady = true;
    detectUpdate();
  }).catch(() => { toast('Offline-Modus konnte nicht vorbereitet werden. Bitte öffne die App später erneut.'); });
  window.addEventListener('online', checkForUpdate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  setInterval(() => { if (!document.hidden) checkForUpdate(); }, 15 * 60 * 1000);
}
if (storageUnavailable()) toast('Der Browser erlaubt kein lokales Speichern. Diese Partie bleibt bis zum Schließen geöffnet.');
