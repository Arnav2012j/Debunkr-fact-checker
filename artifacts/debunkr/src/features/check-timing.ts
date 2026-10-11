// Stores ONLY recent check durations (numbers, ms). Never claim text or results.
const KEY = 'debunkr.checkDurationsMs';
export const DEFAULT_ESTIMATE_SEC = 15;
const MIN_SEC = 8;
const MAX_SEC = 40;

export type CacheState = 'unknown' | 'HIT' | 'MISS' | 'BYPASS';

function read(): number[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0).slice(-5) : [];
  } catch { return []; }
}

export function getEstimateSec(): number {
  const list = read();
  if (!list.length) return DEFAULT_ESTIMATE_SEC;
  const mean = list.reduce((a, b) => a + b, 0) / list.length / 1000;
  return Math.round(Math.min(MAX_SEC, Math.max(MIN_SEC, mean)));
}

export function recordDurationMs(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try { window.localStorage.setItem(KEY, JSON.stringify([...read(), Math.round(ms)].slice(-5))); } catch { /* storage unavailable */ }
}

export function readCacheHeader(response: Response): CacheState {
  const v = response.headers.get('X-Debunkr-Cache')?.trim().toUpperCase();
  return v === 'HIT' || v === 'MISS' || v === 'BYPASS' ? v : 'unknown';
}

/** Dev-only mock tag; ignored entirely in production builds. */
export function isDevMock(response: Response): boolean {
  return import.meta.env.DEV && response.headers.get('X-Debunkr-Dev-Mock') === '1';
}
