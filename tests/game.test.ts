import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, autoFinishAction, canMove, clone, createDeal, isSpider, movableRun, verifyDeal, won, type Board, type Card, type Mode } from '../src/game';

const modes: Mode[] = ['classic-1', 'classic-3', 'freecell', 'spider-1', 'spider-2', 'spider-4'];
const card = (rank: number, suit = 0, up = true, copy = ''): Card => ({ id: `${copy}${suit}-${rank}`, rank, suit, up });
function blank(mode: Mode = 'classic-1'): Board {
  const board = createDeal(mode, 42).board;
  board.tableau = board.tableau.map(() => []); board.stock = []; board.waste = [];
  return board;
}
for (const mode of modes) {
  test(`${mode}: 256 seeds have complete legal winning certificates and correct initial layouts`, () => {
    for (let seed = 0; seed < 256; seed++) {
      const deal = createDeal(mode, seed);
      assert.equal(verifyDeal(deal), true, `certificate failed for seed ${seed}`);
      const all = [...deal.board.tableau.flat(), ...deal.board.stock];
      assert.equal(all.length, isSpider(mode) ? 104 : 52);
      assert.equal(new Set(all.map(c => c.id)).size, all.length);
      assert.deepEqual(deal.board.tableau.map(p => p.length), mode === 'freecell' ? [7, 7, 7, 7, 6, 6, 6, 6] : isSpider(mode) ? [6, 6, 6, 6, 5, 5, 5, 5, 5, 5] : [1, 2, 3, 4, 5, 6, 7]);
      for (const pile of deal.board.tableau) assert.deepEqual(pile.map(c => c.up), mode === 'freecell' ? pile.map(() => true) : pile.map((_, i) => i === pile.length - 1));
      const suitCount = mode === 'spider-1' ? 1 : mode === 'spider-2' ? 2 : 4;
      assert.equal(new Set(all.map(c => c.suit)).size, suitCount);
      for (let rank = 1; rank <= 13; rank++) assert.equal(all.filter(c => c.rank === rank).length, isSpider(mode) ? 8 : 4);
    }
  });
}
test('seeded deals are reproducible and seeds produce different layouts', () => {
  for (const mode of modes) {
    assert.deepEqual(createDeal(mode, 123), createDeal(mode, 123));
    assert.notDeepEqual(createDeal(mode, 123).board.tableau, createDeal(mode, 124).board.tableau);
  }
});
test('applying a move does not mutate the previous board', () => {
  const deal = createDeal('classic-3', 7), before = clone(deal.board);
  assert.ok(apply(deal.board, deal.solution[0])); assert.deepEqual(deal.board, before);
});
test('Klondike accepts alternating runs and only kings in empty columns', () => {
  const board = blank(); board.tableau[0] = [card(8), card(7, 1), card(6)]; board.tableau[1] = [card(9, 1)];
  assert.equal(movableRun(board, { zone: 'tableau', pile: 0 }, '0-8').length, 3);
  assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'tableau', pile: 1 }, card: '0-8' }), true);
  assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'tableau', pile: 2 }, card: '0-8' }), false);
  board.tableau[2] = [card(13)]; assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 2 }, to: { zone: 'tableau', pile: 3 }, card: '0-13' }), true);
});
test('draw three exposes only the top waste card and recycles in original order', () => {
  const board = blank('classic-3'); board.stock = [card(5), card(4), card(3), card(2), card(1)];
  const first = apply(board, { type: 'draw' })!; assert.deepEqual(first.waste.map(c => c.rank), [1, 2, 3]);
  assert.equal(movableRun(first, { zone: 'waste', pile: 0 }, '0-1').length, 0);
  const second = apply(first, { type: 'draw' })!; assert.deepEqual(second.waste.map(c => c.rank), [1, 2, 3, 4, 5]);
  const recycled = apply(second, { type: 'draw' })!; assert.deepEqual(recycled.stock.map(c => c.rank), [5, 4, 3, 2, 1]);
  assert.equal(recycled.waste.length, 0); assert.ok(recycled.stock.every(c => !c.up));
});
test('moving a card flips the hidden card underneath and scores both actions', () => {
  const board = blank(); board.tableau[0] = [card(2, 0, false), card(1)];
  const next = apply(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'foundation', pile: 0 }, card: '0-1' })!;
  assert.equal(next.tableau[0][0].up, true); assert.equal(next.score, 15); assert.equal(board.tableau[0][0].up, false);
});
test('foundation requires ascending cards of its exact suit', () => {
  const board = blank(); board.tableau[0] = [card(2)];
  assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'foundation', pile: 0 }, card: '0-2' }), false);
  board.foundation[0] = [card(1)];
  assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'foundation', pile: 0 }, card: '0-2' }), true);
  assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'foundation', pile: 1 }, card: '0-2' }), false);
});
test('FreeCell supermoves exclude the empty destination and respect occupied cells', () => {
  const board = blank('freecell');
  board.tableau = Array.from({ length: 8 }, (_, i) => [card(13, i % 4, true, `${i}:`)]);
  board.tableau[0] = [card(8), card(7, 1), card(6)]; board.tableau[1] = [];
  board.cells = [[card(1)], [card(1, 1)], [card(1, 2)], []];
  const move = { type: 'move' as const, from: { zone: 'tableau' as const, pile: 0 }, to: { zone: 'tableau' as const, pile: 1 }, card: '0-8' };
  assert.equal(canMove(board, move), false); board.tableau[2] = []; assert.equal(canMove(board, move), true);
  assert.equal(canMove(board, { ...move, to: { zone: 'cell', pile: 3 } }), false);
});
test('Spider moves descending same-suit runs, but permits different-suit placement', () => {
  const board = blank('spider-4'); board.tableau[0] = [card(8), card(7, 1), card(6, 1)]; board.tableau[1] = [card(8, 2)];
  assert.equal(movableRun(board, { zone: 'tableau', pile: 0 }, '0-8').length, 0);
  assert.equal(movableRun(board, { zone: 'tableau', pile: 0 }, '1-7').length, 2);
  assert.equal(canMove(board, { type: 'move', from: { zone: 'tableau', pile: 0 }, to: { zone: 'tableau', pile: 1 }, card: '1-7' }), true);
});
test('Spider cannot draw onto an empty column; completion removes all thirteen and reveals underneath', () => {
  const board = blank('spider-1'); board.stock = Array.from({ length: 10 }, (_, i) => card(2, 0, false, `${i}:`));
  assert.equal(canMove(board, { type: 'draw' }), false);
  board.tableau[0] = [card(5, 1, false), ...Array.from({ length: 12 }, (_, i) => card(13 - i))]; board.tableau[1] = [card(1)];
  const next = apply(board, { type: 'move', from: { zone: 'tableau', pile: 1 }, to: { zone: 'tableau', pile: 0 }, card: '0-1' })!;
  assert.equal(next.foundation[0].length, 13); assert.equal(next.tableau[0][0].up, true); assert.equal(next.score, 599);
});
test('won boards reject further moves', () => {
  const deal = createDeal('classic-1', 23); let board = deal.board;
  for (const action of deal.solution) board = apply(board, action)!;
  assert.equal(won(board), true); assert.equal(apply(board, { type: 'draw' }), null);
});
test('automatic finishing is offered only after proving the entire remaining game', () => {
  const incomplete = blank('freecell'); incomplete.tableau[0] = [card(1)];
  assert.equal(autoFinishAction(incomplete), undefined);
  let board = blank();
  board.foundation = Array.from({ length: 4 }, (_, suit) => Array.from({ length: suit === 0 ? 10 : 13 }, (_, i) => card(i + 1, suit)));
  board.tableau[0] = [card(11)]; board.tableau[1] = [card(12)]; board.tableau[2] = [card(13)];
  assert.ok(autoFinishAction(board));
  while (!won(board)) board = apply(board, autoFinishAction(board)!)!;
  assert.equal(won(board), true);
});
