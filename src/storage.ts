import { apply, clone, createDeal, equalAction, modeNames, type Action, type Board, type Deal, type Mode } from './game';

export interface Settings { theme: 'auto' | 'light' | 'dark'; time: boolean; moves: boolean; score: boolean; animations: boolean }
export interface Stats { played: number; wins: number; bestTime: number | null; bestMoves: number | null; streak: number; bestStreak: number }
interface SavedGame { version: 1; seed: number; actions: Action[]; elapsed: number; started: boolean; recorded: boolean }
export interface Session extends SavedGame { board: Board; deal: Deal; guide: number | null }
const prefix = 'solitaire:v1:';
let storageFailed = false;
export const storageUnavailable = () => storageFailed;
function read(key: string): unknown {
  try { const value = localStorage.getItem(prefix + key); return value ? JSON.parse(value) : null; } catch { return null; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { storageFailed = true; }
}
export function loadSettings(): Settings {
  const defaults: Settings = { theme: 'auto', time: true, moves: true, score: true, animations: true };
  const saved = read('settings');
  if (saved && typeof saved === 'object') {
    const p = saved as Partial<Settings>;
    if (['auto', 'light', 'dark'].includes(p.theme ?? '')) defaults.theme = p.theme!;
    for (const key of ['time', 'moves', 'score', 'animations'] as const) if (typeof p[key] === 'boolean') defaults[key] = p[key];
  }
  return defaults;
}
export const saveSettings = (settings: Settings) => write('settings', settings);
export function loadMode(): Mode {
  const value = read('mode'); return typeof value === 'string' && value in modeNames ? value as Mode : 'classic-1';
}
export const saveMode = (mode: Mode) => write('mode', mode);
export function freshSession(mode: Mode, seed?: number): Session {
  const deal = createDeal(mode, seed);
  return { version: 1, seed: deal.board.seed, deal, board: clone(deal.board), guide: 0, actions: [], elapsed: 0, started: false, recorded: false };
}
export function replay(session: Session): void {
  let board = clone(session.deal.board), guide: number | null = 0;
  for (const action of session.actions) {
    const next = apply(board, action);
    if (!next) throw new Error('Ungültiger Spielstand');
    if (guide !== null) guide = session.deal.solution[guide] && equalAction(action, session.deal.solution[guide]) ? guide + 1 : null;
    board = next;
  }
  session.board = board; session.guide = guide;
}
export function loadSession(mode: Mode): Session {
  try {
    const saved = read('game:' + mode) as SavedGame | null;
    if (saved?.version !== 1 || !Number.isInteger(saved.seed) || !Array.isArray(saved.actions) || saved.actions.length > 20000 ||
      !Number.isFinite(saved.elapsed) || saved.elapsed < 0 || typeof saved.started !== 'boolean' || typeof saved.recorded !== 'boolean') return freshSession(mode);
    const session = { ...freshSession(mode, saved.seed), ...saved };
    replay(session); return session;
  } catch { return freshSession(mode); }
}
export function saveSession(session: Session): void {
  const { version, seed, actions, elapsed, started, recorded } = session;
  write('game:' + session.board.mode, { version, seed, actions, elapsed, started, recorded });
}
export function loadStats(mode: Mode): Stats {
  const defaults: Stats = { played: 0, wins: 0, bestTime: null, bestMoves: null, streak: 0, bestStreak: 0 };
  const saved = read('stats:' + mode) as Stats | null;
  if (!saved || !['played', 'wins', 'streak', 'bestStreak'].every(k => Number.isInteger(saved[k as keyof Stats]) && Number(saved[k as keyof Stats]) >= 0)) return defaults;
  return { ...defaults, ...saved };
}
export const saveStats = (mode: Mode, stats: Stats) => write('stats:' + mode, stats);
export function startStats(session: Session): void {
  if (session.started) return;
  session.started = true; const stats = loadStats(session.board.mode); stats.played++; saveStats(session.board.mode, stats);
}
export function winStats(session: Session): void {
  if (session.recorded) return;
  session.recorded = true; const stats = loadStats(session.board.mode); stats.wins++; stats.streak++;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  stats.bestTime = Math.min(stats.bestTime ?? Infinity, Math.floor(session.elapsed));
  stats.bestMoves = Math.min(stats.bestMoves ?? Infinity, session.board.moves);
  saveStats(session.board.mode, stats);
}
export function abandonStats(session: Session): void {
  if (session.started && !session.recorded) { const stats = loadStats(session.board.mode); stats.streak = 0; saveStats(session.board.mode, stats); }
}
