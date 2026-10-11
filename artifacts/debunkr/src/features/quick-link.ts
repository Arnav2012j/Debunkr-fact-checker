import type { Lang } from '@/settings/settings-store';
import { LANG_CODE } from '@/settings/settings-store';

const SHORT_TO_LANG: Record<string, Lang> = { en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French' };
// C0/C1 controls (except tab/newline/CR) and bidi override/isolate characters.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeClaim(raw: string, max = 2000): string {
  return raw.replace(/\r\n?/g, '\n').replace(UNSAFE, '').trim().slice(0, max).trim();
}

export interface QuickParams { claim: string; lang: Lang | null; auto: boolean }
let parsed: QuickParams | null = null;
let autoTaken = false;

/** Parsed once per page load; later calls return the same object. */
export function readQuickParams(): QuickParams {
  if (parsed) return parsed;
  parsed = { claim: '', lang: null, auto: false };
  try {
    const p = new URLSearchParams(window.location.search);
    parsed.claim = sanitizeClaim(p.get('claim') ?? '');
    parsed.lang = SHORT_TO_LANG[(p.get('lang') ?? '').trim().toLowerCase().slice(0, 2)] ?? null;
    parsed.auto = p.get('auto') === '1' && !!parsed.claim;
  } catch { /* ignore malformed URLs */ }
  return parsed;
}

/** Returns true exactly once per page load, and only when auto=1 with a claim. */
export function takeAutoRun(): boolean {
  if (autoTaken) return false;
  autoTaken = true;
  return readQuickParams().auto;
}

export function appBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base.endsWith('/') ? base : `${base}/`}`;
}

export function quickCheckUrl(claim: string, lang: Lang): string {
  const params = new URLSearchParams({ claim: sanitizeClaim(claim), lang: LANG_CODE[lang] });
  return `${appBaseUrl()}?${params.toString()}`;
}

export function bookmarkletHref(): string {
  const base = JSON.stringify(appBaseUrl());
  const code = `(function(){var b=${base};var s='';try{s=String(window.getSelection?window.getSelection():'').trim().slice(0,500);}catch(e){}var u=s?b+'?'+new URLSearchParams({claim:s}).toString():b;window.open(u,'_blank','noopener');})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
