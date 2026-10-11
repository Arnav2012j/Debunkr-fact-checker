import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** One shared controller: only a single utterance plays at a time across the app. */
type Outcome = 'started' | 'novoice' | 'unsupported' | 'cancelled';

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);
export const speechOutputSupported = () => !!synth() && typeof window.SpeechSynthesisUtterance !== 'undefined';

let owner: string | null = null;
let generation = 0;
const subscribers = new Set<() => void>();
const setOwner = (next: string | null) => { if (owner === next) return; owner = next; subscribers.forEach((fn) => fn()); };
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
const snapshot = () => owner;

export function stopSpeech() {
  generation++;
  const s = synth();
  if (s) { try { s.cancel(); } catch { /* ignore */ } }
  setOwner(null);
}

function loadVoices(s: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      s.removeEventListener('voiceschanged', finish);
      window.clearTimeout(timer);
      resolve(s.getVoices());
    };
    const timer = window.setTimeout(finish, 1800);
    s.addEventListener('voiceschanged', finish);
  });
}

/** Exact tag first, then same base language. Never another language. */
export function pickVoice(voices: SpeechSynthesisVoice[], tag: string): SpeechSynthesisVoice | null {
  const want = tag.toLowerCase();
  const base = want.split('-')[0];
  const norm = (v: SpeechSynthesisVoice) => (v.lang || '').replace('_', '-').toLowerCase();
  const sameBase = voices.filter((v) => norm(v).split('-')[0] === base);
  return sameBase.find((v) => norm(v) === want) ?? sameBase.find((v) => v.localService) ?? sameBase[0] ?? null;
}

async function speak(id: string, text: string, tag: string, rate: number): Promise<Outcome> {
  const s = synth();
  if (!s || !speechOutputSupported()) return 'unsupported';
  stopSpeech();
  const mine = ++generation;
  setOwner(id);
  const voices = await loadVoices(s);
  if (mine !== generation) return 'cancelled';
  const voice = pickVoice(voices, tag);
  if (!voice) { setOwner(null); return 'novoice'; }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;
  const end = () => { if (mine === generation) setOwner(null); };
  u.onend = end;
  u.onerror = end;
  s.speak(u);
  return 'started';
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => stopSpeech());

export function useSpeaker(id: string) {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [supported] = useState(speechOutputSupported);
  const [noVoice, setNoVoice] = useState(false);
  const speaking = current === id;
  const toggle = useCallback(async (text: string, tag: string, rate: number) => {
    if (owner === id) { stopSpeech(); return; }
    setNoVoice(false);
    const out = await speak(id, text, tag, rate);
    if (out === 'novoice') setNoVoice(true);
  }, [id]);
  useEffect(() => () => { if (owner === id) stopSpeech(); }, [id]);
  return { supported, speaking, noVoice, toggle };
}
