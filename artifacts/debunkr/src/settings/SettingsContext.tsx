import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { applyToDocument, clearSettings, defaultSettings, loadSettings, resolveMotion, saveSettings, type Settings } from './settings-store';
import { translate, type TKey } from './translations';

interface Ctx {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
  reduceMotion: boolean;
  persisted: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [persisted, setPersisted] = useState(true);
  const [sysTick, setSysTick] = useState(0);

  useEffect(() => {
    const queries = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)'].map((q) => window.matchMedia(q));
    const onChange = () => setSysTick((n) => n + 1);
    queries.forEach((m) => m.addEventListener('change', onChange));
    return () => queries.forEach((m) => m.removeEventListener('change', onChange));
  }, []);

  useEffect(() => { applyToDocument(settings); }, [settings, sysTick]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => { const next = { ...prev, [key]: value }; setPersisted(saveSettings(next)); return next; });
  }, []);
  const reset = useCallback(() => { clearSettings(); setSettings(defaultSettings()); }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reduceMotion = useMemo(() => resolveMotion(settings.reduceMotion), [settings.reduceMotion, sysTick]);
  const t = useCallback((key: TKey, vars?: Record<string, string | number>) => translate(settings.language, key, vars), [settings.language]);

  const value = useMemo(() => ({ settings, update, reset, reduceMotion, persisted, t }), [settings, update, reset, reduceMotion, persisted, t]);
  return <SettingsCtx.Provider value={value}><MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>{children}</MotionConfig></SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
export const useT = () => useSettings().t;
export const useMotionOff = () => useSettings().reduceMotion;
