import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from '@/settings/settings-store';
import type { TKey } from '@/settings/translations';
import { SPEECH_LANG } from './speech-lang';

interface RecAlt { transcript: string }
interface RecResult { isFinal: boolean; length: number; [i: number]: RecAlt }
interface RecEvent { resultIndex: number; results: { length: number; [i: number]: RecResult } }
interface RecErrorEvent { error: string }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: RecErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecCtor = new () => Recognition;

function getCtor(): RecCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechInputSupported = () => getCtor() !== null;

/**
 * Streams interim + final transcript into the caller via onText(base, spoken).
 * Never submits anything; caller decides what to do with the text.
 */
export function useSpeechInput(language: Lang, onText: (next: string) => void, getBase: () => string) {
  const [supported] = useState(speechInputSupported);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText); onTextRef.current = onText;
  const getBaseRef = useRef(getBase); getBaseRef.current = getBase;

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) { try { rec.stop(); } catch { /* ignore */ } }
  }, []);

  const abortNow = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null; rec.onerror = null; rec.onend = null;
      try { rec.abort(); } catch { /* ignore */ }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    abortNow();
    setError(null);
    const rec = new Ctor();
    rec.lang = SPEECH_LANG[language];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const base = getBaseRef.current().replace(/\s+$/, '');
    rec.onresult = (e) => {
      let spoken = '';
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0]?.transcript ?? '';
      spoken = spoken.trim();
      const next = (base && spoken ? `${base} ${spoken}` : base || spoken).slice(0, 2000);
      onTextRef.current(next);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('mic.denied');
      else if (e.error === 'no-speech') setError('mic.noSpeech');
      else setError('mic.error');
    };
    rec.onend = () => { if (recRef.current === rec) recRef.current = null; setListening(false); };
    recRef.current = rec;
    try { rec.start(); setListening(true); }
    catch { recRef.current = null; setListening(false); setError('mic.error'); }
  }, [abortNow, language]);

  const toggle = useCallback(() => { if (recRef.current) stop(); else start(); }, [start, stop]);

  // Language change or unmount: stop listening safely.
  useEffect(() => () => abortNow(), [abortNow, language]);

  const clearError = useCallback(() => setError(null), []);
  return { supported, listening, error, toggle, stop: abortNow, clearError };
}
