import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bookmark, Clipboard, Link2, Mic, MicOff, Square, Volume2 } from 'lucide-react';
import { useMotionOff, useSettings } from '@/settings/SettingsContext';
import { READ_RATE, type Lang } from '@/settings/settings-store';
import type { TKey } from '@/settings/translations';
import { SPEECH_LANG } from './speech-lang';
import { useSpeaker } from './speech-synth';
import { bookmarkletHref, copyText, quickCheckUrl } from './quick-link';

export function MicButton({ listening, onToggle, disabled }: { listening: boolean; onToggle: () => void; disabled?: boolean }) {
  const { t } = useSettings();
  const reduceMotion = useMotionOff();
  return (
    <button type="button" className={`mic-btn ${listening ? 'listening' : ''}`} onClick={onToggle} disabled={disabled} aria-pressed={listening} aria-label={listening ? t('mic.stop') : t('mic.start')} title={listening ? t('mic.stop') : t('mic.start')} data-testid="button-voice-input">
      {listening && !reduceMotion && <motion.span className="mic-pulse" aria-hidden="true" initial={{ opacity: .5, scale: 1 }} animate={{ opacity: 0, scale: 1.55 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />}
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
  );
}

export function SpeakButton({ id, text, lang, ariaKey, testId }: { id: string; text: string; lang: Lang; ariaKey: TKey; testId: string }) {
  const { t, settings } = useSettings();
  const { supported, speaking, noVoice, toggle } = useSpeaker(id);
  const [languageNotice, setLanguageNotice] = useState(false);
  useEffect(() => setLanguageNotice(false), [settings.language, lang]);
  if (!supported) return null;
  return (
    <div className="speak-wrap">
      <button type="button" className={`speak-btn ${speaking ? 'speaking' : ''}`} onClick={() => {
        if (!speaking && lang !== settings.language) { setLanguageNotice(true); return; }
        setLanguageNotice(false);
        void toggle(text, SPEECH_LANG[settings.language], READ_RATE[settings.readSpeed]);
      }} aria-pressed={speaking} aria-label={speaking ? t('read.stop') : t(ariaKey)} title={speaking ? t('read.stop') : t('read.play')} data-testid={testId}>
        {speaking ? <Square size={13} fill="currentColor" /> : <Volume2 size={15} />}
        <span className="speak-label">{speaking ? t('read.stop') : t('read.play')}</span>
      </button>
      {noVoice && <div className="speak-note" role="status" data-testid={`${testId}-novoice`}>{t('read.noVoice')}</div>}
      {languageNotice && <div className="speak-note" role="status">{t('res.nextNote')}</div>}
    </div>
  );
}

export function CopyQuickLinkButton({ claim, lang }: { claim: string; lang: Lang }) {
  const { t } = useSettings();
  const [notice, setNotice] = useState<TKey | ''>('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!claim.trim()) return null;
  const copy = async () => {
    const ok = await copyText(quickCheckUrl(claim, lang));
    setNotice(ok ? 'res.linkCopied' : 'copy.failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(''), 3200);
  };
  return (
    <div className="quick-copy">
      <button type="button" className="secondary-btn" onClick={() => void copy()} data-testid="button-copy-quick-link"><Link2 size={14} />{t('res.copyLink')}</button>
      <span role="status" className="quick-copy-status" data-testid="status-quick-link">{notice ? t(notice) : ''}</span>
    </div>
  );
}

export function CheckAnywhere() {
  const { t } = useSettings();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [notice, setNotice] = useState<TKey | ''>('');
  const [href] = useState(bookmarkletHref);
  // React blocks javascript: URLs in props, so set the real href directly on the node.
  useEffect(() => { linkRef.current?.setAttribute('href', href); });
  const copy = async () => setNotice((await copyText(href)) ? 'any.copied' : 'copy.failed');
  return (
    <section className="anywhere" aria-labelledby="anywhere-title" data-testid="section-check-anywhere">
      <div className="anywhere-head">
        <h2 id="anywhere-title">{t('any.title')}</h2>
        <p>{t('any.body')}</p>
      </div>
      <div className="anywhere-actions">
        <a ref={linkRef} className="bookmarklet" draggable onClick={(e) => { e.preventDefault(); setNotice('any.clickHint'); }} aria-label={t('any.linkAria')} data-testid="link-bookmarklet"><Bookmark size={14} />{t('any.link')}</a>
        <button type="button" className="secondary-btn" onClick={() => void copy()} data-testid="button-copy-bookmarklet"><Clipboard size={14} />{t('any.copy')}</button>
      </div>
      <div className="anywhere-status" role="status" data-testid="status-bookmarklet">{notice ? t(notice) : ''}</div>
      <div className="anywhere-steps">
        <div><strong>{t('any.desktopTitle')}</strong><span>{t('any.desktop')}</span></div>
        <div><strong>{t('any.mobileTitle')}</strong><span>{t('any.mobile')}</span></div>
      </div>
      <p className="anywhere-note">{t('any.note')}</p>
    </section>
  );
}
