import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { useSettings } from './SettingsContext';
import { LANGS, type Settings } from './settings-store';
import { LANGUAGE_NAMES, type TKey } from './translations';
import { useFocusTrap } from './use-focus-trap';

interface Option<V> { value: V; label: string }

function Segmented<V extends string | number | boolean>({ id, label, value, options, onChange }: { id: string; label: string; value: V; options: Option<V>[]; onChange: (v: V) => void }) {
  return (
    <div className="set-row">
      <span className="set-label" id={`set-${id}-label`}>{label}</span>
      <div className="set-seg" role="radiogroup" aria-labelledby={`set-${id}-label`}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)} data-testid={`setting-${id}-${String(o.value)}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const { settings, update, reset, t, persisted, reduceMotion } = useSettings();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<TKey | ''>('');
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => { setNotice(''); update(k, v); };
  const tri = (a: TKey, b: TKey) => [{ value: 'light', label: t(a) }, { value: 'dark', label: t(b) }, { value: 'system', label: t('set.system') }];
  return (
    <>
      <motion.div className="set-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .2 }} onMouseDown={onClose} data-testid="backdrop-settings" />
      <motion.div ref={ref} className="set-panel sticker-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : 10 }} transition={{ duration: .24, ease: [0.22, 1, 0.36, 1] }} data-testid="panel-settings">
        <div className="set-grip" aria-hidden="true" />
        <div className="set-head">
          <div><h2 id="settings-title">{t('set.title')}</h2><p>{t('set.sub')}</p></div>
          <button type="button" className="set-close" onClick={onClose} aria-label={t('set.close')} data-testid="button-close-settings"><X size={17} /></button>
        </div>
        <div className="set-body">
          <Segmented id="theme" label={t('set.theme')} value={settings.theme} options={tri('set.light', 'set.dark') as Option<Settings['theme']>[]} onChange={set('theme')} />
          <div className="set-row">
            <label className="set-label" htmlFor="settings-language">{t('set.language')}</label>
            <select id="settings-language" className="set-select" value={settings.language} onChange={(e) => set('language')(e.target.value as Settings['language'])} data-testid="setting-language">
              {LANGS.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
            </select>
          </div>
          <Segmented id="explanation" label={t('set.explanation')} value={settings.explanation} options={[0, 1, 2].map((v) => ({ value: v as Settings['explanation'], label: t(`tone.${v}` as TKey) }))} onChange={set('explanation')} />
          <Segmented id="text" label={t('set.textSize')} value={settings.textSize} options={[{ value: 'small', label: t('set.small') }, { value: 'medium', label: t('set.medium') }, { value: 'large', label: t('set.large') }] as Option<Settings['textSize']>[]} onChange={set('textSize')} />
          <Segmented id="motion" label={t('set.motion')} value={settings.reduceMotion} options={[{ value: 'on', label: t('set.on') }, { value: 'off', label: t('set.off') }, { value: 'system', label: t('set.system') }] as Option<Settings['reduceMotion']>[]} onChange={set('reduceMotion')} />
          <Segmented id="hero" label={t('set.hero')} value={settings.showHero} options={[{ value: true, label: t('set.show') }, { value: false, label: t('set.hide') }]} onChange={set('showHero')} />
          <Segmented id="speed" label={t('set.readSpeed')} value={settings.readSpeed} options={[{ value: 'slow', label: t('set.slow') }, { value: 'normal', label: t('set.normal') }, { value: 'fast', label: t('set.fast') }] as Option<Settings['readSpeed']>[]} onChange={set('readSpeed')} />
        </div>
        <div className="set-foot">
          {confirming ? (
            <div className="set-confirm" role="group" aria-label={t('set.resetConfirm')}>
              <span>{t('set.resetConfirm')}</span>
              <button type="button" className="secondary-btn" onClick={() => setConfirming(false)} data-testid="button-reset-cancel">{t('set.cancel')}</button>
              <button type="button" className="primary-btn" onClick={() => { reset(); setConfirming(false); setNotice('set.resetDone'); }} data-testid="button-reset-confirm">{t('set.resetYes')}</button>
            </div>
          ) : (
            <button type="button" className="secondary-btn set-reset" onClick={() => setConfirming(true)} data-testid="button-reset-settings"><RotateCcw size={14} />{t('set.reset')}</button>
          )}
          <div role="status" className="set-status" data-testid="status-settings">{notice ? t(notice) : !persisted ? t('set.noStorage') : ''}</div>
        </div>
      </motion.div>
    </>
  );
}

export function SettingsButton() {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <div className="set-anchor">
      <button type="button" className="gear-btn" aria-label={t('nav.settings')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="button-open-settings"><SettingsIcon size={18} /><span className="gear-label">{t('nav.settings')}</span></button>
      <AnimatePresence>{open && <Panel onClose={() => setOpen(false)} />}</AnimatePresence>
    </div>
  );
}
