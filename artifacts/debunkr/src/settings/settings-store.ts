export type ThemePref = 'light' | 'dark' | 'system';
export type MotionPref = 'on' | 'off' | 'system';
export type TextSize = 'small' | 'medium' | 'large';
export type Lang = 'English' | 'Hindi' | 'Spanish' | 'French';
export type Tone = 0 | 1 | 2;
export type ReadSpeed = 'slow' | 'normal' | 'fast';
export const READ_RATE: Record<ReadSpeed, number> = { slow: 0.8, normal: 1, fast: 1.25 };

export interface Settings {
  theme: ThemePref;
  language: Lang;
  explanation: Tone;
  textSize: TextSize;
  reduceMotion: MotionPref;
  showHero: boolean;
  readSpeed: ReadSpeed;
}

export const STORAGE_KEY = 'debunkr.settings.v1';
export const LANGS: Lang[] = ['English', 'Hindi', 'Spanish', 'French'];
const PREFIX: Record<string, Lang> = { en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French' };
export const LANG_CODE: Record<Lang, string> = { English: 'en', Hindi: 'hi', Spanish: 'es', French: 'fr' };

export function browserLanguage(): Lang {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of list) { const hit = PREFIX[(l || '').slice(0, 2).toLowerCase()]; if (hit) return hit; }
  } catch { /* ignore */ }
  return 'English';
}

export function defaultSettings(): Settings {
  return { theme: 'system', language: browserLanguage(), explanation: 0, textSize: 'medium', reduceMotion: 'system', showHero: true, readSpeed: 'normal' };
}

const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return d;
    const p = parsed as Partial<Settings>;
    return {
      theme: pick(p.theme, ['light', 'dark', 'system'] as const, d.theme),
      language: pick(p.language, LANGS, d.language),
      explanation: pick(p.explanation, [0, 1, 2] as const, d.explanation),
      textSize: pick(p.textSize, ['small', 'medium', 'large'] as const, d.textSize),
      reduceMotion: pick(p.reduceMotion, ['on', 'off', 'system'] as const, d.reduceMotion),
      showHero: typeof p.showHero === 'boolean' ? p.showHero : d.showHero,
      readSpeed: pick(p.readSpeed, ['slow', 'normal', 'fast'] as const, d.readSpeed),
    };
  } catch { return d; }
}

/** Returns false when storage is unavailable; settings still work for the session. */
export function saveSettings(s: Settings): boolean {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function clearSettings() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

const mq = (q: string) => { try { return window.matchMedia(q).matches; } catch { return false; } };
export const systemDark = () => mq('(prefers-color-scheme: dark)');
export const systemReduce = () => mq('(prefers-reduced-motion: reduce)');

export function resolveTheme(p: ThemePref): 'light' | 'dark' { return p === 'system' ? (systemDark() ? 'dark' : 'light') : p; }
export function resolveMotion(p: MotionPref): boolean { return p === 'system' ? systemReduce() : p === 'on'; }

export function applyToDocument(s: Settings) {
  const root = document.documentElement;
  const theme = resolveTheme(s.theme);
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  root.dataset.textSize = s.textSize;
  root.dataset.motion = resolveMotion(s.reduceMotion) ? 'reduce' : 'full';
  root.lang = LANG_CODE[s.language];
}
