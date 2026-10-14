export type Mode = 'classic-1' | 'classic-3' | 'freecell' | 'spider-1' | 'spider-2' | 'spider-4';
export type Zone = 'tableau' | 'foundation' | 'cell' | 'waste';
export interface Card { id: string; rank: number; suit: number; up: boolean }
export interface Slot { zone: Zone; pile: number }
export type Action = { type: 'draw' } | { type: 'move'; from: Slot; to: Slot; card: string };
export interface Board {
  mode: Mode; seed: number; tableau: Card[][]; foundation: Card[][]; cells: Card[][];
  stock: Card[]; waste: Card[]; moves: number; score: number;
}
export interface Deal { board: Board; solution: Action[] }
export const suits = ['♠', '♥', '♣', '♦'];
export const suitNames = ['Pik', 'Herz', 'Kreuz', 'Karo'];
export const rankNames = ['', 'Ass', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Bube', 'Dame', 'König'];
export const rankLabel = (rank: number) => ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'][rank];
export const isRed = (card: Card) => card.suit === 1 || card.suit === 3;
export const isSpider = (mode: Mode) => mode.startsWith('spider');
export const modeNames: Record<Mode, string> = {
  'classic-1': 'Classic · 1 Karte', 'classic-3': 'Classic · 3 Karten', freecell: 'FreeCell',
  'spider-1': 'Spider · 1 Farbe', 'spider-2': 'Spider · 2 Farben', 'spider-4': 'Spider · 4 Farben',
};
export const clone = <T>(value: T): T => structuredClone(value);
export const top = <T>(pile: T[]): T | undefined => pile.at(-1);
export function pileAt(board: Board, slot: Slot): Card[] {
  if (slot.zone === 'tableau') return board.tableau[slot.pile] ?? [];
  if (slot.zone === 'foundation') return board.foundation[slot.pile] ?? [];
  if (slot.zone === 'cell') return board.cells[slot.pile] ?? [];
  return slot.pile === 0 ? board.waste : [];
}
export function won(board: Board): boolean {
  return board.foundation.reduce((n, p) => n + p.length, 0) === (isSpider(board.mode) ? 104 : 52);
}
export function movableRun(board: Board, slot: Slot, cardId: string): Card[] {
  const pile = pileAt(board, slot);
  const index = pile.findIndex(c => c.id === cardId);
  if (index < 0 || !pile[index].up || (slot.zone !== 'tableau' && index !== pile.length - 1)) return [];
  if (isSpider(board.mode) && slot.zone === 'foundation') return [];
  const run = pile.slice(index);
  for (let i = 1; i < run.length; i++) {
    if (!run[i].up || run[i - 1].rank !== run[i].rank + 1) return [];
    if (isSpider(board.mode) ? run[i - 1].suit !== run[i].suit : isRed(run[i - 1]) === isRed(run[i])) return [];
  }
  return run;
}
export function canMove(board: Board, action: Action): boolean {
  if (won(board)) return false;
  if (action.type === 'draw') {
    return isSpider(board.mode)
      ? board.stock.length >= 10 && board.tableau.every(p => p.length > 0)
      : board.mode.startsWith('classic') && (board.stock.length > 0 || board.waste.length > 0);
  }
  const { from, to } = action;
  if (from.zone === to.zone && from.pile === to.pile) return false;
  const limits: Record<Zone, number> = { tableau: board.tableau.length, foundation: board.foundation.length, cell: board.cells.length, waste: 1 };
  if (from.pile < 0 || to.pile < 0 || from.pile >= limits[from.zone] || to.pile >= limits[to.zone]) return false;
  const run = movableRun(board, from, action.card);
  if (!run.length) return false;
  const target = pileAt(board, to);
  const head = run[0];
  if (to.zone === 'foundation') {
    return !isSpider(board.mode) && run.length === 1 && head.suit === to.pile && head.rank === target.length + 1;
  }
  if (to.zone === 'cell') return board.mode === 'freecell' && run.length === 1 && target.length === 0;
  if (to.zone !== 'tableau') return false;
  const last = top(target);
  if (last && (!last.up || last.rank !== head.rank + 1 || (!isSpider(board.mode) && isRed(last) === isRed(head)))) return false;
  if (!last && board.mode.startsWith('classic') && head.rank !== 13) return false;
  if (board.mode === 'freecell') {
    // The destination empty column cannot be used as an intermediate column.
    const free = board.cells.filter(p => !p.length).length;
    const empty = board.tableau.filter((p, i) => !p.length && i !== to.pile).length;
    if (run.length > (free + 1) * 2 ** empty) return false;
  }
  return true;
}
function reveal(board: Board, pile: Card[]): void {
  const card = top(pile);
  if (card && !card.up) { card.up = true; if (!isSpider(board.mode)) board.score += 5; }
}
function clearSpider(board: Board): void {
  for (const pile of board.tableau) {
    while (pile.length >= 13) {
      const run = pile.slice(-13);
      if (!run.every((c, i) => c.up && c.rank === 13 - i && c.suit === run[0].suit)) break;
      board.foundation.find(p => !p.length)!.push(...pile.splice(-13));
      board.score += 100;
      reveal(board, pile);
    }
  }
}
export function apply(board: Board, action: Action): Board | null {
  if (!canMove(board, action)) return null;
  const next = clone(board);
  next.moves++;
  if (isSpider(next.mode)) next.score--;
  if (action.type === 'draw') {
    if (isSpider(next.mode)) {
      for (const pile of next.tableau) { const card = next.stock.pop()!; card.up = true; pile.push(card); }
      clearSpider(next);
    } else if (next.stock.length) {
      const amount = next.mode === 'classic-3' ? 3 : 1;
      for (let i = 0; i < amount && next.stock.length; i++) {
        const card = next.stock.pop()!; card.up = true; next.waste.push(card);
      }
    } else {
      next.stock = next.waste.reverse().map(c => ({ ...c, up: false }));
      next.waste = []; next.score = Math.max(0, next.score - 20);
    }
    return next;
  }
  const source = pileAt(next, action.from);
  const index = source.findIndex(c => c.id === action.card);
  pileAt(next, action.to).push(...source.splice(index));
  if (action.from.zone === 'tableau') reveal(next, source);
  if (!isSpider(next.mode)) {
    if (action.to.zone === 'foundation') next.score += 10;
    else if (action.from.zone === 'foundation') next.score = Math.max(0, next.score - 15);
    else if (action.from.zone === 'waste' && action.to.zone === 'tableau') next.score += 5;
  } else clearSpider(next);
  return next;
}
export function legalActions(board: Board): Action[] {
  const actions: Action[] = [];
  const sources: Slot[] = [
    ...board.tableau.map((_, pile) => ({ zone: 'tableau' as const, pile })),
    ...board.cells.map((_, pile) => ({ zone: 'cell' as const, pile })),
    { zone: 'waste', pile: 0 },
  ];
  const destinations: Slot[] = [
    ...board.foundation.map((_, pile) => ({ zone: 'foundation' as const, pile })),
    ...board.tableau.map((_, pile) => ({ zone: 'tableau' as const, pile })),
    ...board.cells.map((_, pile) => ({ zone: 'cell' as const, pile })),
  ];
  for (const from of sources) {
    for (const card of pileAt(board, from)) {
      for (const to of destinations) {
        const action: Action = { type: 'move', from, to, card: card.id };
        if (canMove(board, action)) actions.push(action);
      }
    }
  }
  if (canMove(board, { type: 'draw' })) actions.push({ type: 'draw' });
  return actions;
}
export function autoFinishAction(board: Board): Action | undefined {
  if (isSpider(board.mode) || board.stock.length || board.tableau.some(p => p.some(c => !c.up))) return;
  const find = (state: Board): Action | undefined => {
    const slots: Slot[] = [...state.tableau.map((_, pile) => ({ zone: 'tableau' as const, pile })),
      ...state.cells.map((_, pile) => ({ zone: 'cell' as const, pile })), { zone: 'waste', pile: 0 }];
    for (const from of slots) {
      const card = top(pileAt(state, from));
      if (card && card.rank === state.foundation[card.suit].length + 1) return { type: 'move', from, to: { zone: 'foundation', pile: card.suit }, card: card.id };
    }
  };
  const first = find(board);
  let simulated = board;
  for (let i = 0; i < 52; i++) {
    if (won(simulated)) return first;
    const move = find(simulated); if (!move) return;
    const next = apply(simulated, move); if (!next) return;
    simulated = next;
  }
  return won(simulated) ? first : undefined;
}
export function equalAction(a: Action, b: Action): boolean {
  return a.type === b.type && (a.type === 'draw' || (b.type === 'move' && a.card === b.card &&
    a.from.zone === b.from.zone && a.from.pile === b.from.pile && a.to.zone === b.to.zone && a.to.pile === b.to.pile));
}
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const choose = <T>(items: T[], rng: () => number): T => items[Math.floor(rng() * items.length)];
function emptyBoard(mode: Mode, seed: number): Board {
  return { mode, seed, tableau: Array.from({ length: mode === 'freecell' ? 8 : isSpider(mode) ? 10 : 7 }, () => []),
    foundation: Array.from({ length: isSpider(mode) ? 8 : 4 }, () => []), cells: mode === 'freecell' ? [[], [], [], []] : [],
    stock: [], waste: [], moves: 0, score: isSpider(mode) ? 500 : 0 };
}
function classic(mode: Mode, seed: number, rng: () => number): Deal {
  const board = emptyBoard(mode, seed);
  const ranks = [1, 1, 1, 1];
  const left = [1, 2, 3, 4, 5, 6, 7];
  board.tableau = left.map(n => Array<Card>(n));
  const solution: Action[] = [];
  const chronological: Card[] = [];
  const newCard = (): Card => {
    const suit = choose([0, 1, 2, 3].filter(s => ranks[s] <= 13), rng);
    const rank = ranks[suit]++;
    return { id: `${suit}-${rank}`, rank, suit, up: true };
  };
  while (left.some(Boolean) || chronological.length < 24) {
    const columns = left.map((n, i) => n ? i : -1).filter(i => i >= 0);
    if (columns.length && (chronological.length === 24 || rng() < .66)) {
      const pile = choose(columns, rng);
      const card = newCard();
      const index = --left[pile];
      board.tableau[pile][index] = { ...card, up: index === pile };
      solution.push({ type: 'move', from: { zone: 'tableau', pile }, to: { zone: 'foundation', pile: card.suit }, card: card.id });
    } else {
      const amount = Math.min(mode === 'classic-3' ? 3 : 1, 24 - chronological.length);
      const packet: Card[] = Array(amount);
      solution.push({ type: 'draw' });
      for (let i = amount - 1; i >= 0; i--) {
        const card = newCard(); packet[i] = { ...card, up: false };
        solution.push({ type: 'move', from: { zone: 'waste', pile: 0 }, to: { zone: 'foundation', pile: card.suit }, card: card.id });
      }
      chronological.push(...packet);
    }
  }
  board.stock = chronological.reverse();
  return { board, solution };
}
function freecell(seed: number, rng: () => number): Deal {
  const board = emptyBoard('freecell', seed);
  const caps = [7, 7, 7, 7, 6, 6, 6, 6];
  const ranks = [13, 13, 13, 13];
  const reverse: Action[] = [];
  // Reverse legal moves bury cards, introducing dependencies while preserving a proof.
  for (let step = 0; ranks.some(Boolean); step++) {
    if (step > 0 && rng() < .7) {
      const eligible = board.tableau.map((p, i) => {
        const c = top(p), below = p.at(-2);
        return c && (!below || (below.rank === c.rank + 1 && isRed(below) !== isRed(c))) ? i : -1;
      }).filter(i => i >= 0);
      if (eligible.length) {
        const source = choose(eligible, rng);
        const targets = board.tableau.map((p, i) => i !== source && p.length < caps[i] ? i : -1).filter(i => i >= 0);
        if (targets.length) {
          const dest = choose(targets, rng); const card = board.tableau[source].pop()!;
          board.tableau[dest].push(card);
          reverse.push({ type: 'move', from: { zone: 'tableau', pile: dest }, to: { zone: 'tableau', pile: source }, card: card.id });
        }
      }
    }
    const suit = choose([0, 1, 2, 3].filter(s => ranks[s] > 0), rng);
    const rank = ranks[suit]--;
    const dest = choose(board.tableau.map((p, i) => p.length < caps[i] ? i : -1).filter(i => i >= 0), rng);
    const card: Card = { id: `${suit}-${rank}`, rank, suit, up: true };
    board.tableau[dest].push(card);
    reverse.push({ type: 'move', from: { zone: 'tableau', pile: dest }, to: { zone: 'foundation', pile: suit }, card: card.id });
  }
  return { board, solution: reverse.reverse() };
}
function spider(mode: Mode, seed: number, rng: () => number): Deal {
  const board = emptyBoard(mode, seed);
  const caps = [6, 6, 6, 6, 5, 5, 5, 5, 5, 5];
  const pool = choose([4, 5, 6, 7, 8, 9], rng);
  const colors = Number(mode.split('-')[1]);
  const colorsList = colors === 1 ? [0] : colors === 2 ? [0, 1] : [0, 1, 2, 3];
  const sequenceSuits = Array.from({ length: 8 }, (_, i) => colorsList[i % colors]);
  for (let i = 7; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [sequenceSuits[i], sequenceSuits[j]] = [sequenceSuits[j], sequenceSuits[i]]; }
  const reverse: Action[] = [];
  // Eight returned sequences supply cards to nine columns. Five visible rows
  // are removed afterwards to become the stock. Every reverse transfer has
  // a legal forward inverse, including flips and automatic sequence removal.
  for (let sequence = 0; sequence < 8; sequence++) {
    const prior = top(board.tableau[pool]);
    if (prior && sequence <= 4) prior.up = false;
    const suit = sequenceSuits[sequence];
    board.tableau[pool].push(...Array.from({ length: 13 }, (_, i) => ({ id: `${sequence}-${13 - i}`, rank: 13 - i, suit, up: true })));
    const amount = sequence === 7 ? 10 : 12;
    for (let i = 0; i < amount; i++) {
      let targets = board.tableau.map((p, col) => col !== pool && p.length < caps[col] ? col : -1).filter(col => col >= 0);
      const fillingBase = targets.length > 0;
      if (!fillingBase) targets = board.tableau.map((p, col) => col !== pool && p.length < caps[col] + 5 ? col : -1).filter(col => col >= 0);
      const dest = choose(targets, rng);
      const prior = top(board.tableau[dest]);
      if (prior && fillingBase) prior.up = false;
      const card = board.tableau[pool].pop()!;
      board.tableau[dest].push(card);
      reverse.push({ type: 'move', from: { zone: 'tableau', pile: dest }, to: { zone: 'tableau', pile: pool }, card: card.id });
    }
  }
  for (let row = 0; row < 5; row++) {
    const cards = board.tableau.map(p => p.pop()!);
    board.stock.push(...cards.reverse().map(c => ({ ...c, up: false })));
    reverse.push({ type: 'draw' });
  }
  return { board, solution: reverse.reverse() };
}
export function createDeal(mode: Mode, seed = crypto.getRandomValues(new Uint32Array(1))[0]): Deal {
  const rng = random(seed);
  return mode.startsWith('classic') ? classic(mode, seed, rng) : mode === 'freecell' ? freecell(seed, rng) : spider(mode, seed, rng);
}
export function verifyDeal(deal: Deal): boolean {
  let board = clone(deal.board);
  for (const action of deal.solution) { const next = apply(board, action); if (!next) return false; board = next; }
  return won(board);
}
