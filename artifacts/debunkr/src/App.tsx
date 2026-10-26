import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { toPng } from 'html-to-image';
import {
  ArrowRight, Ban, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clipboard, CloudUpload, FileImage, Flag, Globe2, Link2, LoaderCircle,
  MessageCircle, RotateCcw, Search, Share2, ShieldCheck, Tag, X,
} from 'lucide-react';
import { SettingsProvider, useMotionOff, useSettings, useT } from '@/settings/SettingsContext';
import { SettingsButton } from '@/settings/SettingsPanel';
import { type Lang, type Tone } from '@/settings/settings-store';
import { translate, type TKey } from '@/settings/translations';
import { CheckAnywhere, CopyQuickLinkButton, MicButton, SpeakButton } from '@/features/FeatureUI';
import { useSpeechInput } from '@/features/use-speech-input';
import { stopSpeech } from '@/features/speech-synth';
import { readQuickParams, takeAutoRun } from '@/features/quick-link';
import '@/features/features.css';
import { getEstimateSec, isDevMock, readCacheHeader, recordDurationMs, type CacheState } from '@/features/check-timing';
import { checkClaim, useCheckClaim } from '@workspace/api-client-react';
import type { CheckInput, CheckResult, CheckedClaim } from '@workspace/api-client-react';

const queryClient = new QueryClient();

const exampleKeys: TKey[] = ['home.ex1', 'home.ex2', 'home.ex3'];
const placeholderKeys: TKey[] = ['home.ph1', 'home.ph2', 'home.ph3'];
type UiError = { key: TKey } | null;
const API_CODES = ['INVALID_INPUT', 'INVALID_URL', 'INVALID_IMAGE', 'RATE_LIMIT_REACHED', 'KEY_MISSING', 'GEMINI_RATE_LIMITED', 'INVALID_KEY', 'GEMINI_ERROR', 'UNREADABLE_RESPONSE', 'INTERNAL_ERROR', 'REQUEST_TOO_LARGE', 'CHECK_TIMEOUT'] as const;

function Logo() {
  return <div className="logo" aria-label="Debunkr"><span className="logo-mark"><ShieldCheck size={16} strokeWidth={2.6} /></span><span>Debunkr</span></div>;
}

function Footer() {
  const t = useT();
  return <footer className="footer">{t('footer')}</footer>;
}

type MascotState = 'idle' | 'thinking' | 'happy' | 'shocked' | 'puzzled' | 'error' | 'wave';
function DeskMascot({ state = 'idle', testId = 'img-mascot' }: { state?: MascotState; testId?: string }) {
  const reduceMotion = useMotionOff();
  const arms: Record<MascotState, string> = {
    idle: 'M48 104c-15 7-24 17-31 15M128 104c15 7 24 17 31 15',
    thinking: 'M48 104c-14 4-20-7-14-17M128 104c12-2 18-14 10-25',
    happy: 'M48 100c-14-8-22-24-20-36M128 100c14-8 22-24 20-36',
    shocked: 'M48 98c-18-4-27-17-27-30M128 98c18-4 27-17 27-30',
    puzzled: 'M48 104c-15 7-24 17-31 15M128 100c14-4 15-20 5-28',
    error: 'M48 108c-12 10-22 14-30 10M128 108c12 10 22 14 30 10',
    wave: 'M48 104c-15 7-24 17-31 15M128 100c18-8 24-22 28-42',
  };
  const mouth: Record<MascotState, ReactNode> = {
    idle: <path d="M76 112q12 9 24 0" />, wave: <path d="M76 110q12 12 24 0" />, happy: <path d="M72 108q16 18 32 0" />,
    thinking: <path d="M80 114h18" />, shocked: <ellipse cx="88" cy="114" rx="7" ry="9" />, puzzled: <path d="M77 115q6-6 12 0t12 0" />, error: <path d="M76 117q12-9 24 0" />,
  };
  const sway = state === 'thinking' ? { rotate: [-5, 5, -5] } : state === 'happy' ? { y: [0, -12, 0], scale: [1, 1.06, 1] } : state === 'shocked' ? { x: [0, -5, 5, -3, 0] } : state === 'puzzled' ? { rotate: [-8, -3, -8] } : state === 'wave' ? { rotate: [0, -3, 0] } : { y: [0, -5, 0] };
  return <motion.div className={`desk-mascot mascot-${state}`} role="img" aria-hidden="true" data-testid={testId}
    initial={{ rotate: state === 'puzzled' ? -8 : 0 }}
    animate={reduceMotion ? { rotate: state === 'puzzled' ? -8 : 0 } : sway}
    transition={reduceMotion ? { duration: 0 } : state === 'happy' ? { type: 'spring', stiffness: 260, damping: 9, repeat: 2 } : state === 'shocked' ? { duration: .45, repeat: 2 } : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
    <svg viewBox="0 0 180 175">
      <path d={arms[state]} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d="M38 98c0-31 21-54 52-54s52 23 52 54v20c0 16-17 25-52 25s-52-9-52-25z" fill="#FFD23F" stroke="#17151F" strokeWidth="5" />
      <path d="m115 64 23 22" stroke="#17151F" strokeWidth="11" strokeLinecap="round" />
      <path d="m115 64 23 22" stroke="#FF4B3E" strokeWidth="5" strokeLinecap="round" />
      <circle cx="94" cy="68" r="31" fill="#FFFFFF" stroke="#17151F" strokeWidth="6" />
      <circle cx="94" cy="68" r="22" fill="#DDF3FF" stroke="#17151F" strokeWidth="2" />
      <motion.g style={{ transformOrigin: '94px 68px' }} animate={reduceMotion ? undefined : { scaleY: [1, 1, .1, 1] }} transition={reduceMotion ? undefined : { duration: 4.2, repeat: Infinity, times: [0, .9, .93, 1] }}>
        {state === 'happy' ? <path d="M84 70q10-12 20 0" fill="none" stroke="#17151F" strokeWidth="6" strokeLinecap="round" /> : state === 'error' ? <path d="m86 61 16 16m0-16-16 16" stroke="#17151F" strokeWidth="5" strokeLinecap="round" /> : <circle cx={state === 'thinking' ? 101 : 94} cy={state === 'thinking' ? 61 : 69} r={state === 'shocked' ? 12 : 9} fill="#17151F" />}
        {state !== 'happy' && state !== 'error' && <circle cx={state === 'thinking' ? 104 : 97} cy={state === 'thinking' ? 58 : 66} r="3" fill="#FFFFFF" />}
      </motion.g>
      <g fill="none" stroke="#17151F" strokeWidth="5" strokeLinecap="round">{mouth[state]}</g>
      {state === 'puzzled' && <text x="146" y="44" fontSize="34" fontWeight="800" fill="#5BB5FF" stroke="#17151F" strokeWidth="2">?</text>}
      {state === 'shocked' && <path d="M148 30v24M160 38l-9 16M136 38l7 16" stroke="#FF4B3E" strokeWidth="5" strokeLinecap="round" />}
      {state === 'thinking' && <g fill="#5BB5FF" stroke="#17151F" strokeWidth="2"><circle cx="146" cy="44" r="5" /><circle cx="158" cy="30" r="7" /></g>}
      <path d="m29 38 5-10 6 10 10 4-10 5-6 10-5-10-10-5zM151 129l4-7 4 7 7 3-7 4-4 7-4-7-7-4z" fill="#22C58B" stroke="#17151F" strokeWidth="2" />
    </svg>
  </motion.div>;
}

function FirstVisitHint() {
  const { t } = useSettings();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try { if (window.localStorage.getItem('debunkr.gearHint.dismissed') !== '1') setVisible(true); } catch { setVisible(true); }
    const timer = window.setTimeout(() => {
      setVisible(false);
      try { window.localStorage.setItem('debunkr.gearHint.dismissed', '1'); } catch { /* storage is optional */ }
    }, 10000);
    return () => window.clearTimeout(timer);
  }, []);
  const dismiss = () => {
    setVisible(false);
    try { window.localStorage.setItem('debunkr.gearHint.dismissed', '1'); } catch { /* storage is optional */ }
  };
  return <AnimatePresence>{visible && <motion.div className="gear-hint" role="status" data-testid="status-settings-hint" initial={{ opacity: 0, y: -7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
    <DeskMascot state="wave" testId="img-mascot-hint" />
    <span>{t('hint.settings')}</span>
    <button type="button" onClick={dismiss} data-testid="button-dismiss-hint">{t('hint.gotIt')}</button>
  </motion.div>}</AnimatePresence>;
}

function XrayCard() {
  const reduceMotion = useMotionOff();
  const t = useT();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => setPhase((v) => (v + 1) % 2), 6200);
    return () => window.clearInterval(id);
  }, [reduceMotion]);
  const trueSample = phase === 1;
  return (
    <motion.div className="xray" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .12 }}>
      <div className="xray-top"><span>{t('xray.title')}</span><span className="eyebrow-dot" /></div>
      <AnimatePresence mode="wait">
        <motion.div key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0, x: !trueSample && !reduceMotion ? [0, -2, 2, -1, 0] : 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .35 }}>
          <div className="xray-msg">
            {trueSample ? (
              <>{t('xray.trueA')} <strong className="mark mark-true">{t('xray.trueB')}</strong> {t('xray.trueC')}</>
            ) : (
              <>{t('xray.falseA')} <strong className="mark mark-false">{t('xray.falseB')}</strong> <span className="mark mark-unclear">{t('xray.falseC')}</span></>
            )}
          </div>
          {!reduceMotion && <motion.div className="xray-line" initial={{ y: -18, opacity: 0 }} animate={{ y: [0, 170, 0], opacity: [0, 1, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }} />}
          <div className="xray-result">
            <span>{trueSample ? t('xray.fact') : t('xray.signals')}</span>
            <motion.span className={trueSample ? 'legit-badge' : 'false-stamp'} animate={reduceMotion ? {} : trueSample ? { rotate: [-3, 3, 0], scale: [0.8, 1.06, 1] } : { rotate: [-9, 4, -4], scale: [.4, 1.08, 1] }} transition={{ duration: .55, delay: 1.1, type: 'spring', stiffness: 360, damping: 13 }}>
              {trueSample ? t('xray.legit') : t('xray.false')}
            </motion.span>
          </div>
          {trueSample && !reduceMotion && <div aria-hidden="true" style={{ position: 'absolute', right: 28, bottom: 30, pointerEvents: 'none' }}>{['var(--d-v-true)', 'var(--d-v-unclear)', 'var(--d-ink)', 'var(--d-v-true)'].map((color, i) => <motion.i key={i} style={{ display: 'inline-block', width: 5, height: 8, borderRadius: 2, background: color, margin: 3 }} initial={{ opacity: 0, y: -4, rotate: 0 }} animate={{ opacity: [0, 1, 0], y: [0, 15 + i * 2, 28], rotate: [0, 90, 180] }} transition={{ duration: .9, delay: 1 + i * .08 }} />)}</div>}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function HomeView({ onSubmit, pending, initialClaim }: { onSubmit: (claim: string, image?: { base64: string; mime: CheckInput['imageMime']; name: string }) => void; pending: boolean; initialClaim: string }) {
  const reduceMotion = useMotionOff();
  const { t, settings } = useSettings();
  const [tab, setTab] = useState<'claim' | 'image'>('claim');
  const [claim, setClaim] = useState(initialClaim);
  const claimRef = useRef(claim); claimRef.current = claim;
  const voice = useSpeechInput(settings.language, setClaim, () => claimRef.current);
  const stopVoice = voice.stop;
  useEffect(() => { if (tab !== 'claim') stopVoice(); }, [tab, stopVoice]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [image, setImage] = useState<{ base64: string; mime: CheckInput['imageMime']; name: string; url: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(() => setPlaceholderIndex((n) => (n + 1) % placeholderKeys.length), 3400);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);
  const prepareImage = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return;
    try {
      const source = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(source.width * scale);
      canvas.height = Math.round(source.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      let mime: 'image/jpeg' | 'image/png' = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      let encoded = canvas.toDataURL(mime, .86);
      if (encoded.length > 3_900_000 && mime === 'image/png') {
        mime = 'image/jpeg';
        encoded = canvas.toDataURL(mime, .82);
      }
      if (encoded.length > 3_900_000) {
        let q = .72;
        while (encoded.length > 3_900_000 && q > .35) { encoded = canvas.toDataURL('image/jpeg', q); q -= .1; }
        mime = 'image/jpeg';
      }
      setImage({ base64: encoded.split(',')[1], mime, name: file.name, url: encoded });
    } catch { setImage(null); }
  };
  const submit = () => { voice.stop(); onSubmit(claim.trim(), image ? { base64: image.base64, mime: image.mime, name: image.name } : undefined); };
  return (
    <main className="main">
      <div className="home-fold">
      <section className={`home-hero ${settings.showHero ? '' : 'no-hero'}`}>
        <motion.div className="hero-copy" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }}>
          <h1><span className="headline-question">{t('home.title1')}<motion.span className="headline-swoosh" aria-hidden="true" initial={reduceMotion ? { scaleX: 1 } : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: .7, delay: .35 }} /></span><br />{t('home.title2')}</h1>
        </motion.div>
        {settings.showHero && <DeskMascot state="idle" testId="img-mascot-home" />}
      </section>
      <section className="input-card" aria-label={t('home.checkAria')}>
        <div className="tabs" role="tablist">
          <button className={`tab ${tab === 'claim' ? 'active' : ''}`} onClick={() => setTab('claim')} role="tab" aria-selected={tab === 'claim'} data-testid="tab-claim"><Link2 size={14} />{t('home.tabClaim')}</button>
          <button className={`tab ${tab === 'image' ? 'active' : ''}`} onClick={() => setTab('image')} role="tab" aria-selected={tab === 'image'} data-testid="tab-image"><FileImage size={14} />{t('home.tabImage')}</button>
        </div>
        {tab === 'claim' ? (
          <div>
            <textarea className="claim-box" value={claim} maxLength={2000} onChange={(e) => { setClaim(e.target.value); if (voice.error) voice.clearError(); }} placeholder={t(placeholderKeys[placeholderIndex])} aria-label={t('home.claimAria')} data-testid="input-claim" />
            <div className="input-bottom">{voice.listening ? <span className="hint listening" role="status" data-testid="status-listening">{t('mic.listening')}</span> : voice.error ? <span className="hint mic-err" role="alert" data-testid="status-voice-error">{t(voice.error)}</span> : <span className="hint">{t('home.charHint', { n: claim.length })}</span>}<div className="input-actions">{voice.supported && <MicButton listening={voice.listening} onToggle={voice.toggle} disabled={pending} />}<button className="primary-btn" disabled={pending || !claim.trim()} onClick={submit} data-testid="button-check-claim">{pending ? <LoaderCircle size={15} /> : <Search size={15} />}{t('home.checkThis')}</button></div></div>
          </div>
        ) : (
          <div style={{ paddingTop: 15 }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void prepareImage(e.target.files?.[0])} data-testid="input-image-file" />
            <div className={`upload-drop ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void prepareImage(e.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()} data-testid="dropzone-image">
              <div><CloudUpload size={22} /><strong>{t('home.dropTitle')}</strong><span>{t('home.dropHint')}</span></div>
            </div>
            {image && <div className="upload-preview"><img src={image.url} alt={t('home.previewAlt')} /><span>{t('home.ready', { name: image.name })}</span><button className="close-btn" aria-label={t('home.removeImage')} onClick={(e) => { e.stopPropagation(); setImage(null); }} data-testid="button-remove-image"><X size={15} /></button></div>}
            <div className="input-bottom"><span className="hint">{t('home.imageHint')}</span><button className="primary-btn" disabled={pending || !image} onClick={submit} data-testid="button-check-image">{pending ? <LoaderCircle size={15} /> : <Search size={15} />}{t('home.checkImage')}</button></div>
          </div>
        )}
      <div className="examples"><span className="examples-label">{t('home.tryExample')}</span>{exampleKeys.map((key, i) => <motion.button key={key} className="example-chip" whileHover={reduceMotion ? undefined : { rotate: [0, -2, 2, 0] }} transition={{ duration: .28 }} onClick={() => { setTab('claim'); setClaim(t(key)); }} data-testid={`button-example-${i + 1}`}>{t(key)}</motion.button>)}</div>
      </section>
      </div>
      <details className="in-action">
        <summary>{t('home.seeAction')}</summary>
        <div className="in-action-content">
          <section className="how">
            <h2>{t('how.title')}</h2>
            <div className="how-row">
              <div className="how-item"><div className="how-icon"><Clipboard size={16} /></div><div><strong>{t('how.t1')}</strong><span>{t('how.b1')}</span></div></div>
              <div className="how-item"><div className="how-icon"><Globe2 size={16} /></div><div><strong>{t('how.t2')}</strong><span>{t('how.b2')}</span></div></div>
              <div className="how-item"><div className="how-icon"><MessageCircle size={16} /></div><div><strong>{t('how.t3')}</strong><span>{t('how.b3')}</span></div></div>
            </div>
          </section>
          <XrayCard />
          <CheckAnywhere />
        </div>
      </details>
      <Footer />
    </main>
  );
}

type Attempt = { id: number; start: number; estimate: number; cache: CacheState };

function useElapsedSec(start: number, running: boolean) {
  const [elapsed, setElapsed] = useState(() => Math.floor((performance.now() - start) / 1000));
  useEffect(() => {
    setElapsed(Math.floor((performance.now() - start) / 1000));
    if (!running) return;
    const id = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [start, running]);
  return elapsed;
}

function stepFor(elapsed: number, estimate: number) {
  const r = elapsed / estimate;
  return r >= .8 ? 3 : r >= .4 ? 2 : r >= .1 ? 1 : 0;
}

function WaitTimer({ elapsed, attempt, onAnnounce }: { elapsed: number; attempt: Attempt; onAnnounce: (key: TKey, n?: number) => void }) {
  const t = useT();
  const reduceMotion = useMotionOff();
  const { estimate, id } = attempt;
  const announceRef = useRef(onAnnounce); announceRef.current = onAnnounce;
  const spoken = useRef<{ id: number; start: boolean; half: boolean }>({ id: -1, start: false, half: false });
  const visible = elapsed >= 1;
  useEffect(() => {
    if (spoken.current.id !== id) spoken.current = { id, start: false, half: false };
    if (!visible) return;
    if (!spoken.current.start) { spoken.current.start = true; announceRef.current('wait.srStart', estimate); }
    else if (!spoken.current.half && elapsed >= estimate / 2) { spoken.current.half = true; announceRef.current('wait.srHalf'); }
  }, [visible, elapsed, estimate, id]);
  if (!visible) return <div className="wait-timer wait-timer-pending" aria-hidden="true" />;
  const over = elapsed >= estimate;
  const remaining = Math.max(1, estimate - elapsed);
  const pct = Math.round(Math.min(.95, elapsed / estimate) * 100);
  return <div className="wait-timer" data-testid="status-wait-timer">
    <div className="wait-line" data-testid="text-wait-estimate">{over ? t('wait.longer', { n: elapsed }) : t('wait.estimate', { n: remaining })}</div>
    <div className="wait-elapsed" data-testid="text-wait-elapsed">{t('wait.elapsed', { n: elapsed })}</div>
    {reduceMotion
      ? <div className="wait-pct" data-testid="text-wait-progress">{t('wait.progress', { n: pct })}</div>
      : <div className="wait-track" role="progressbar" aria-label={t('wait.progressAria')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="wait-fill" style={{ transform: `scaleX(${pct / 100})` }} /></div>}
    {elapsed >= 30 && <p className="wait-slow" data-testid="text-wait-slow">{t('wait.slow')}</p>}
  </div>;
}

function AnalysisView({ claim, attempt, error, pending, onRetry, onReset, onAnnounce }: { claim: string; attempt: Attempt; error: UiError; pending: boolean; onRetry: () => void; onReset: () => void; onAnnounce: (key: TKey, n?: number) => void }) {
  const t = useT();
  const reduceMotion = useMotionOff();
  const hit = attempt.cache === 'HIT';
  const running = pending && !error && !hit;
  const elapsed = useElapsedSec(attempt.start, running);
  const step = hit ? 3 : stepFor(elapsed, attempt.estimate);
  const steps = [t('an.s1'), t('an.s2'), t('an.s3'), t('an.s4')];
  return (
    <main className="main analysis">
      <div className="eyebrow" style={{ justifyContent: 'center' }}><span className="eyebrow-dot" />{t('an.eyebrow')}</div>
      <div className="analysis-mascot"><DeskMascot state={error ? 'error' : 'thinking'} testId="img-mascot-analysis" /></div>
      <h1 className="page-title">{t('an.title')}</h1>
      <p className="page-subtitle">{t('an.sub')}</p>
      <motion.div className="analysis-claim" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="content-analysis-claim">
        {!reduceMotion && <motion.div className="analysis-scan" animate={{ y: [0, 96, 0], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }} />}
        {claim || t('an.screenshot')}
      </motion.div>
      {hit && <div className="instant-note" data-testid="text-instant-analysis">{t('wait.instant')}</div>}
      <div className="steps" data-testid="tracker-analysis-steps">{steps.map((label, i) => <div className={`step ${i < step ? 'done' : i === step ? 'current' : ''}`} key={label}><span className="step-dot">{i < step ? <Check size={14} /> : i === step ? <LoaderCircle size={14} /> : i + 1}</span>{label}</div>)}</div>
      {running && <WaitTimer elapsed={elapsed} attempt={attempt} onAnnounce={onAnnounce} />}
      {!error && <><motion.div className="skeleton-card" animate={reduceMotion ? { opacity: .8 } : { opacity: [.56, .95, .56] }} transition={{ duration: 1.5, repeat: reduceMotion ? 0 : Infinity }} aria-label={t('an.loading')} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}><motion.div className="skeleton-card" style={{ height: 96 }} animate={reduceMotion ? { opacity: .8 } : { opacity: [.6, .9, .6] }} transition={{ duration: 1.5, repeat: reduceMotion ? 0 : Infinity, delay: .2 }} /><motion.div className="skeleton-card" style={{ height: 96 }} animate={reduceMotion ? { opacity: .8 } : { opacity: [.6, .9, .6] }} transition={{ duration: 1.5, repeat: reduceMotion ? 0 : Infinity, delay: .4 }} /></div></>}
      {error && <div className="error-card" role="alert" data-testid="status-check-error"><div><strong>{t('an.errTitle')}</strong><br />{t(error.key)}</div><div style={{ display: 'flex', gap: 8 }}><button className="secondary-btn" onClick={onReset} data-testid="button-cancel-error">{t('an.back')}</button><button className="primary-btn" onClick={onRetry} disabled={pending} data-testid="button-retry-check"><RotateCcw size={14} />{t('an.retry')}</button></div></div>}
      <Footer />
    </main>
  );
}

function verdictClass(value?: string) {
  return value === 'TRUE' ? 'true' : value === 'FALSE' ? 'false' : 'unclear';
}
function VerdictIcon({ verdict, size = 17 }: { verdict?: string; size?: number }) {
  if (verdict === 'TRUE') return <CheckCircle2 size={size} />;
  if (verdict === 'FALSE') return <Ban size={size} />;
  return <CircleHelp size={size} />;
}

const toneKeys: TKey[] = ['tone.0', 'tone.1', 'tone.2'];
const verdictKey = (v?: string): TKey => (v === 'TRUE' ? 'verdict.TRUE' : v === 'FALSE' ? 'verdict.FALSE' : 'verdict.UNCLEAR');
function ResultDisclosure({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reduceMotion = useMotionOff();
  return <section className="result-disclosure">
    <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id} data-testid={testId} onClick={() => setOpen((value) => !value)}>{title}<span aria-hidden="true">{open ? '−' : '+'}</span></button>
    <AnimatePresence initial={false}>{open && <motion.div id={id} className="disclosure-content" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }} transition={{ duration: .2 }}>{children}</motion.div>}</AnimatePresence>
  </section>;
}
function CountUp({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => `${Math.round(latest)}%`);
  const reduceMotion = useMotionOff();
  useEffect(() => {
    if (reduceMotion) { count.set(value); return; }
    const controls = animate(count, value, { duration: .8, ease: 'easeOut' });
    return controls.stop;
  }, [count, reduceMotion, value]);
  return <motion.span>{rounded}</motion.span>;
}
function ClaimDetail({ item, index, tone, setTone, intro, calmReply, speech, lang }: { item?: CheckedClaim; index: number; tone: Tone; setTone: (t: Tone) => void; intro: ReactNode; calmReply?: string; speech: string; lang: Lang }) {
  const t = useT();
  const [openTactic, setOpenTactic] = useState<number | null>(null);
  const explanation = item ? [item.explanation, item.explanation_simple, item.explanation_elder][tone] : '';
  const breakdown = item?.evidence_breakdown;
  const total = breakdown ? Math.max(1, breakdown.supporting + breakdown.disputing + breakdown.neutral) : 1;
  const sources = item?.sources?.filter((source) => {
    try { return ['http:', 'https:'].includes(new URL(source.url).protocol); } catch { return false; }
  }) ?? [];
  const sourceCount = sources.length;
  const strength = Math.max(0, Math.min(100, item?.evidence_strength || 0));
  const tacticDescription = (tactic: string, i: number) => item?.tactic_explanations?.[i] || t('res.tacticFallback', { tactic });
  return (
    <section className="result-details" data-testid={`panel-claim-explanation-${index}`}>
      <ResultDisclosure title={t('res.whyThink')} testId="button-disclosure-why">
          {intro}
          {item ? <>
          <div className="detail-top"><span className={`claim-sticker ${verdictClass(item.verdict)}`}><VerdictIcon verdict={item.verdict} size={13} />{t(verdictKey(item.verdict))}</span></div>
          <div className="tone-toggle" role="group" aria-label={t('tone.label')}>{toneKeys.map((key, i) => <button key={key} className={tone === i ? 'active' : ''} aria-pressed={tone === i} onClick={() => setTone(i as Tone)} data-testid={`button-tone-${i}`}>{t(key)}</button>)}</div>
          <h2 className="selected-claim">{item.text}</h2>
          {explanation && <AnimatePresence mode="wait"><motion.p key={tone} className="explanation" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: .18 }} data-testid={`text-explanation-${index}`}>{explanation}</motion.p></AnimatePresence>}
          <div className="detail-speak"><SpeakButton id={`claim-${index}`} text={speech} lang={lang} ariaKey="read.claimAria" testId={`button-read-claim-${index}`} /></div>
          </> : <div className="empty-note"><DeskMascot state="puzzled" testId="img-mascot-empty" /><p className="original-text">{t('res.noDetails')}</p></div>}
          {calmReply && <div className="reply-card"><h3 className="panel-title" style={{ marginBottom: 7 }}>{t('res.calmReply')}</h3><p data-testid="text-calm-reply">{calmReply}</p></div>}
      </ResultDisclosure>
      <ResultDisclosure title={t('res.sourcesPanel')} testId="button-disclosure-sources">
          {sources.length ? sources.map((source, i) => <motion.a className="source-card" key={`${source.url}-${i}`} href={source.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .12 }} data-testid={`card-source-${index}-${i}`}><div className="source-meta"><span className="source-type">{source.type}</span><ArrowRight size={13} className="source-arrow" /></div><div className="source-title">{source.title}</div><div className="source-publisher">{source.publisher}</div><div className="source-url">{source.url}</div></motion.a>) : <p className="original-text">{t('res.noSources')}</p>}
      </ResultDisclosure>
      <ResultDisclosure title={t('res.spreads')} testId="button-disclosure-spread">
          {!!item?.red_flags?.length && <div className="detail-section"><h3>{t('res.redFlags')}</h3>{item.red_flags.map((flag, i) => <div className="redflag" key={`${flag}-${i}`}><Flag size={13} />{flag}</div>)}</div>}
          {!!item?.tactics?.length && <div className="detail-section"><h3>{t('res.tactics')}</h3><div className="tactics">{item.tactics.map((tactic, i) => <div className="tactic-wrap" key={`${tactic}-${i}`}><button className="tactic" onClick={() => setOpenTactic(openTactic === i ? null : i)} data-testid={`button-tactic-${index}-${i}`}><Tag size={11} />{tactic}<ChevronDown size={11} /></button><AnimatePresence>{openTactic === i && <motion.div className="tactic-pop" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>{tacticDescription(tactic, i)}</motion.div>}</AnimatePresence></div>)}</div></div>}
          {item?.why_it_spreads && <div className="detail-section"><h3>{t('res.why')}</h3><div className="why-card">{item.why_it_spreads}</div></div>}
          {!item?.red_flags?.length && !item?.tactics?.length && !item?.why_it_spreads && <p className="original-text">{t('res.noSpread')}</p>}
      </ResultDisclosure>
      <ResultDisclosure title={t('res.evidenceAtGlance')} testId="button-disclosure-evidence">
          <div className="meter-title"><span>{t('res.strength')}</span><span className="evidence-number" data-testid={`text-evidence-strength-${index}`}><CountUp value={strength} /></span></div>
          <div className="meter-track"><motion.div className="meter-fill" initial={{ scaleX: 0 }} animate={{ scaleX: strength / 100 }} transition={{ duration: .9, delay: .12 }} /></div>
          {breakdown && <div className="agreement"><div className="meter-title"><span>{t('res.agreement')}</span><span>{t('res.sources', { n: sourceCount })}</span></div><div className="agreement-bar" data-testid={`bar-evidence-agreement-${index}`}><motion.span className="support" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.supporting / total * 100}%`, transformOrigin: 'left' }} /><motion.span className="dispute" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.disputing / total * 100}%`, transformOrigin: 'left' }} /><motion.span className="neutral" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.neutral / total * 100}%`, transformOrigin: 'left' }} /></div><div className="agreement-legend"><span>{t('res.supporting', { n: breakdown.supporting })}</span><span>{t('res.disputing', { n: breakdown.disputing })}</span><span>{t('res.neutral', { n: breakdown.neutral })}</span></div></div>}
      </ResultDisclosure>
    </section>
  );
}

function ShareModal({ result, claim, selected, onClose }: { result: CheckResult; claim: CheckedClaim; selected: number; onClose: () => void }) {
  const t = useT();
  const [notice, setNotice] = useState<TKey | ''>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const mood = verdictClass(result.overall_verdict);
  const sources = claim.sources?.filter((s) => {
    try { return ['http:', 'https:'].includes(new URL(s.url).protocol); } catch { return false; }
  }).slice(0, 2).map((s) => s.publisher || s.title).filter(Boolean) ?? [];
  const reason = claim.explanation?.split(/[.!?]/)[0] || result.summary || t('share.reasonFallback');
  const copyText = `${claim.text}\n\n${t(verdictKey(result.overall_verdict))}: ${reason}.\n${t('share.checked')}`;
  const shareText = async () => {
    try { await navigator.clipboard.writeText(copyText); setNotice('share.copied'); }
    catch { setNotice('share.noClipboard'); }
  };
  const downloadPng = async () => {
    const card = cardRef.current;
    if (!card) { setNotice('share.noImage'); return; }
    setIsDownloading(true);
    try {
      const pixelRatio = 1080 / Math.max(1, card.getBoundingClientRect().width);
      const dataUrl = await toPng(card, { cacheBust: true, pixelRatio });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'debunkr-check.png';
      link.click();
      setNotice('share.downloaded');
    } catch {
      setNotice('share.imageRetry');
    } finally {
      setIsDownloading(false);
    }
  };
  const nativeShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: t('share.nativeTitle'), text: copyText }); setNotice('share.shared'); }
      catch (e) { if (e instanceof Error && e.name !== 'AbortError') setNotice('share.unavailable'); }
    } else await shareText();
  };
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="modal-share">
    <motion.div className="modal" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="modal-head"><h2 id="share-title">{t('share.title')}</h2><button className="close-btn" onClick={onClose} aria-label={t('share.close')} data-testid="button-close-share"><X size={17} /></button></div>
      <div className="share-layout">
        <div ref={cardRef} className="share-canvas" data-testid="preview-share-card"><div><Logo /><span className={`badge-verdict ${mood}`} style={{ marginTop: 34 }}><VerdictIcon verdict={result.overall_verdict} />{t(verdictKey(result.overall_verdict))}</span><div className="share-claim">{claim.text}</div><div className="share-reason">{reason}.</div><div className="share-strength">{t('share.strength', { n: claim.evidence_strength || 0 })}</div></div><div className="share-bottom">{sources.length ? `${t('share.sources', { list: sources.join(' · ') })}  |  ` : ''}{t('share.footer')}</div></div>
        <div className="share-actions"><p>{t('share.body')}</p><button className="primary-btn" onClick={() => void downloadPng()} disabled={isDownloading} data-testid="button-download-share">{isDownloading ? <LoaderCircle size={15} /> : <FileImage size={15} />}{isDownloading ? t('share.rendering') : t('share.download')}</button><button className="secondary-btn" onClick={() => void shareText()} data-testid="button-copy-share"><Clipboard size={15} />{t('share.copy')}</button><button className="secondary-btn" onClick={() => void nativeShare()} data-testid="button-native-share"><Share2 size={15} />{t('share.share')}</button>{notice && <div role="status" className="share-status" data-testid="status-share">{t(notice)}</div>}</div>
      </div>
    </motion.div>
  </motion.div>;
}

function ResultsView({ result, inputClaim, quickClaim, resultLang, timing, onReset }: { result: CheckResult; inputClaim: string; quickClaim: string; resultLang: Lang; timing: { cache: CacheState; sec: number } | null; onReset: () => void }) {
  const { t, settings } = useSettings();
  const reduceMotion = useMotionOff();
  const [selected, setSelectedRaw] = useState(0);
  const [tone, setTone] = useState<Tone>(settings.explanation);
  const setSelected = (i: number) => { if (i !== selected) { setSelectedRaw(i); setTone(settings.explanation); } };
  // Stop any reading when the claim, style or language changes, and when leaving results.
  useEffect(() => { stopSpeech(); }, [selected, tone, settings.language]);
  useEffect(() => () => stopSpeech(), []);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const selectedClaim = result.claims?.[selected];
  const allClaimText = result.claims?.map((c) => c.text).filter(Boolean).join(' ') || inputClaim;
  const matches = (result.claims || []).map((item, index) => ({ text: item.text, index })).filter((item) => item.text);
  const renderHighlighted = () => {
    const lowerText = allClaimText.toLowerCase();
    const found = matches.map((item) => ({ ...item, start: lowerText.indexOf(item.text.toLowerCase()) })).filter((item) => item.start >= 0).sort((a, b) => a.start - b.start);
    if (!found.length) return allClaimText;
    const parts: ReactNode[] = [];
    let cursor = 0;
    found.forEach((item) => {
      if (item.start < cursor) return;
      if (item.start > cursor) parts.push(allClaimText.slice(cursor, item.start));
      parts.push(<button key={`highlight-${item.index}`} className="highlighted-claim" onClick={() => setSelected(item.index)} data-testid={`highlight-claim-${item.index}`}>{allClaimText.slice(item.start, item.start + item.text.length)}</button>);
      cursor = item.start + item.text.length;
    });
    if (cursor < allClaimText.length) parts.push(allClaimText.slice(cursor));
    return parts;
  };
  const copyReply = async () => {
    if (!result.calm_reply) return;
    try { await navigator.clipboard.writeText(result.calm_reply); setCopied(true); window.setTimeout(() => setCopied(false), 2400); }
    catch { setCopied(false); }
  };
  const mood = verdictClass(result.overall_verdict);
  const tr = (key: TKey) => translate(resultLang, key);
  const actionText = result.action || tr('res.actionFallback');
  const explanationFor = (c?: CheckedClaim) => (c ? [c.explanation, c.explanation_simple, c.explanation_elder][tone] || c.explanation || '' : '');
  const join = (parts: (string | undefined)[]) => parts.map((p) => (p || '').trim()).filter(Boolean).map((p) => (/[.!?।]$/.test(p) ? p : `${p}.`)).join(' ');
  const overallSpeech = join([tr(verdictKey(result.overall_verdict)), actionText, explanationFor(selectedClaim) || result.summary]);
  const claimSpeech = selectedClaim ? join([tr(verdictKey(selectedClaim.verdict)), actionText, explanationFor(selectedClaim)]) : '';
  const mascotState: MascotState = mood === 'true' ? 'happy' : mood === 'false' ? 'shocked' : 'puzzled';
  return <main className={`main results mood-${mood}`} data-testid="content-results">
    <div className="results-head"><div><div className="eyebrow"><span className="eyebrow-dot" />{t('res.complete')}</div><h1>{result.overall_verdict === 'TRUE' ? t('res.headTrue') : result.overall_verdict === 'FALSE' ? t('res.headFalse') : t('res.headUnclear')}</h1></div></div>
    <p className="next-note" data-testid="text-next-check-note">{t('res.nextNote')}</p>
    {timing && <p className="time-note" data-testid="text-check-time">{timing.cache === 'HIT' ? t('wait.instant') : t('wait.took', { n: timing.sec })}</p>}
    <motion.div className={`verdict-hero ${mood}`} initial={{ opacity: 0, y: 12 }} animate={mood === 'false' && !reduceMotion ? { opacity: 1, y: [0, 3, -2, 0] } : { opacity: 1, y: 0 }} transition={{ duration: mood === 'false' ? .36 : .3 }} data-testid="status-overall-verdict">
      <motion.div className={`verdict-sticker ${mood}`} data-testid="badge-overall-verdict" initial={reduceMotion ? { rotate: mood === 'unclear' ? -9 : -5 } : { scale: .3, rotate: mood === 'false' ? -28 : -14 }} animate={mood === 'false' && !reduceMotion ? { scale: 1, rotate: [-12, 6, -6, -5] } : { scale: 1, rotate: mood === 'unclear' ? -9 : -5 }} transition={{ type: 'spring', stiffness: 320, damping: 12 }}><VerdictIcon verdict={result.overall_verdict} size={22} /><span>{t(verdictKey(result.overall_verdict))}</span></motion.div>
      <div className="verdict-body"><div className="verdict-label">{result.overall_verdict === 'TRUE' ? t('res.legit') : result.overall_verdict === 'FALSE' ? t('res.headFalse') : t('res.headUnclear')}</div><p>{result.summary || t('res.summaryFallback')}</p><div className="action-line">{actionText}</div></div>
      <div className="verdict-mascot"><DeskMascot state={mascotState} testId="img-mascot-verdict" /></div>
      {result.overall_verdict === 'FALSE' && <motion.div className="verdict-stamp" initial={reduceMotion ? { scale: 1, rotate: -8, opacity: 0 } : { scale: .45, rotate: -15, opacity: 0 }} animate={{ scale: 1, rotate: -8, opacity: .28 }} transition={{ type: 'spring', stiffness: 310, damping: 14, delay: .16 }}>{t('verdict.FALSE')}</motion.div>}
      {result.overall_verdict === 'UNCLEAR' && <motion.div className="verdict-question" aria-hidden="true" initial={{ rotate: reduceMotion ? -8 : -18, scale: .5, opacity: 0 }} animate={{ rotate: -8, scale: 1, opacity: .22 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>?</motion.div>}
      {result.overall_verdict === 'TRUE' && !reduceMotion && <div className="verdict-confetti" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <motion.svg key={i} viewBox="0 0 24 24" width="22" height="22" initial={{ opacity: 0, y: 0, rotate: 0, scale: .4 }} animate={{ opacity: [0, 1, 0], y: [0, 26 + i * 6, 64], x: (i - 2.5) * 14, rotate: [0, 120, 220], scale: 1 }} transition={{ duration: 1.2, delay: .2 + i * .07 }}>{i % 2 ? <path d="M2 14c4-8 6 8 10 0s6 8 10 0" fill="none" stroke={i % 3 ? '#5BB5FF' : '#FF4B3E'} strokeWidth="3.5" strokeLinecap="round" /> : <path d="m12 2 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill={i === 2 ? '#FFD23F' : '#22C58B'} stroke="#17151F" strokeWidth="1.8" />}</motion.svg>)}</div>}
    </motion.div>
    <div className="results-actions" aria-label={t('res.actions')}>
      <button className="share-btn" onClick={() => setShareOpen(true)} data-testid="button-open-share"><Share2 size={15} />{t('res.share')}</button>
      <button className="secondary-btn" onClick={() => void copyReply()} disabled={!result.calm_reply} data-testid="button-copy-calm-reply">{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? t('res.copied') : t('res.copyReply')}</button>
      <SpeakButton id="overall" text={overallSpeech} lang={resultLang} ariaKey="read.overallAria" testId="button-read-overall" />
    </div>
    <ClaimDetail key={selected} item={selectedClaim} index={selected} tone={tone} setTone={setTone} calmReply={result.calm_reply} speech={claimSpeech} lang={resultLang} intro={<div className="why-intro">
      <h3 className="panel-title">{t('res.examined')}</h3>
      <p className="original-text" data-testid="text-original-claim">{renderHighlighted()}</p>
      {(result.claims?.length ?? 0) > 1 && <><h3 className="panel-title">{t('res.claimsFound')}</h3>
        {result.claims?.map((item, i) => <button key={`${item.text}-${i}`} className={`claim-select ${i === selected ? 'selected' : ''}`} onClick={() => setSelected(i)} aria-pressed={i === selected} data-testid={`button-select-claim-${i}`}><span className={`claim-sticker ${verdictClass(item.verdict)}`}><VerdictIcon verdict={item.verdict} size={13} />{t(verdictKey(item.verdict))}</span>{item.text}</button>)}</>}
    </div>} />
    <div className="utility-row">
      <CopyQuickLinkButton claim={quickClaim} lang={resultLang} />
      <button onClick={onReset} className="secondary-btn" data-testid="button-new-check"><RotateCcw size={14} />{t('res.another')}</button>
    </div>
    <Footer />
    <AnimatePresence>{shareOpen && selectedClaim && <ShareModal result={result} claim={selectedClaim} selected={selected} onClose={() => setShareOpen(false)} />}</AnimatePresence>
  </main>;
}

function Experience() {
  const [view, setView] = useState<'home' | 'analysis' | 'results'>('home');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [submittedClaim, setSubmittedClaim] = useState('');
  const [error, setError] = useState<UiError>(null);
  const { settings, update, t } = useSettings();
  const language = settings.language;
  const [quick] = useState(readQuickParams);
  const [prefill, setPrefill] = useState(quick.claim);
  const [resultLang, setResultLang] = useState<Lang>(language);
  const [attempt, setAttempt] = useState<Attempt>(() => ({ id: 0, start: performance.now(), estimate: getEstimateSec(), cache: 'unknown' }));
  const [timing, setTiming] = useState<{ cache: CacheState; sec: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const attemptRef = useRef({ id: 0, start: 0, cache: 'unknown' as CacheState, mock: false });
  // Request-scoped: each outgoing input object is tagged with its attempt ID (in memory only).
  const attemptOf = useRef(new WeakMap<CheckInput, number>());
  const headerForAttempt = (response: Response, id: number) => {
    const a = attemptRef.current;
    if (a.id !== id) return; // stale response after reset / newer submit
    a.cache = readCacheHeader(response);
    a.mock = isDevMock(response);
    const cache = a.cache;
    if (cache === 'HIT') setAttempt((cur) => (cur.id === id ? { ...cur, cache } : cur));
  };
  const headerRef = useRef(headerForAttempt); headerRef.current = headerForAttempt;
  const mutation = useCheckClaim({ mutation: { mutationFn: ({ data }) => {
    const capturedId = attemptOf.current.get(data) ?? -1;
    return checkClaim(data, { onResponse: (response) => headerRef.current(response, capturedId) });
  } } });
  const lastInput = useRef<CheckInput | null>(null);
  const announceKey = (key: TKey, n?: number) => setAnnounce(t(key, n === undefined ? undefined : { n }));
  const beginAttempt = () => {
    const id = attemptRef.current.id + 1;
    const start = performance.now();
    attemptRef.current = { id, start, cache: 'unknown', mock: false };
    setAttempt({ id, start, estimate: getEstimateSec(), cache: 'unknown' });
    setTiming(null);
    setAnnounce('');
    return id;
  };
  const finish = (id: number, data: CheckResult) => {
    const a = attemptRef.current;
    if (a.id !== id) return;
    const ms = performance.now() - a.start;
    if ((a.cache === 'MISS' || a.cache === 'BYPASS') && !a.mock) recordDurationMs(ms);
    setTiming({ cache: a.cache, sec: Math.max(1, Math.round(ms / 1000)) });
    setAnnounce(t('wait.srDone'));
    setResult(data); setView('results');
  };
  const submitInput = (claim: string, image?: { base64: string; mime: CheckInput['imageMime']; name: string }, langOverride?: Lang) => {
    const requestLang = langOverride ?? language;
    const cleaned = claim.trim();
    if (!cleaned && !image) { setError({ key: 'err.empty' }); return; }
    if (cleaned.length > 2000) { setError({ key: 'err.length' }); return; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) {
      try { const url = new URL(cleaned); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { setError({ key: 'err.link' }); return; }
    }
    setError(null);
    setResult(null);
    setSubmittedClaim(cleaned || image?.name || t('an.imageClaim'));
    stopSpeech();
    setPrefill('');
    setResultLang(requestLang);
    const input: CheckInput = { language: requestLang, ...(cleaned ? { claim: cleaned } : {}), ...(image ? { imageBase64: image.base64, imageMime: image.mime } : {}) };
    lastInput.current = input;
    setView('analysis');
    const id = beginAttempt();
    attemptOf.current.set(input, id);
    mutation.mutate({ data: input }, {
      onSuccess: (data) => finish(id, data),
      onError: (err) => { if (attemptRef.current.id !== id) return; setError(toUiError(err)); setView('analysis'); },
    });
  };
  const submitRef = useRef(submitInput); submitRef.current = submitInput;
  useEffect(() => {
    if (quick.lang) update('language', quick.lang);
    // takeAutoRun is a module-level once-guard, safe under StrictMode double effects.
    if (takeAutoRun()) submitRef.current(quick.claim, undefined, quick.lang ?? undefined);
  }, [quick, update]);
  const retry = () => {
    if (!lastInput.current) { setView('home'); return; }
    setResultLang(lastInput.current.language as Lang);
    setError(null);
    setView('analysis');
    const id = beginAttempt();
    const retryInput: CheckInput = { ...lastInput.current };
    attemptOf.current.set(retryInput, id);
    mutation.mutate({ data: retryInput }, {
      onSuccess: (data) => finish(id, data),
      onError: (err) => { if (attemptRef.current.id === id) setError(toUiError(err)); },
    });
  };
  const reset = () => { attemptRef.current = { ...attemptRef.current, id: attemptRef.current.id + 1 }; setTiming(null); setAnnounce(''); stopSpeech(); setView('home'); setError(null); setResult(null); setSubmittedClaim(''); mutation.reset(); };
  const mood = view === 'results' && result ? verdictClass(result.overall_verdict) : undefined;
  return <div className="shell" data-mood={mood}>
    <header className="topbar"><button onClick={reset} style={{ border: 0, background: 'transparent', padding: 0, minHeight: 44 }} aria-label={t('nav.home')} data-testid="button-logo-home"><Logo /></button><div className="nav-right"><button className="nav-link" onClick={reset} data-testid="link-fact-check">{t('nav.factCheck')}</button><SettingsButton /></div></header>
    {view === 'home' && <FirstVisitHint />}
    {view === 'home' && <HomeView onSubmit={submitInput} pending={mutation.isPending} initialClaim={prefill} />}
    {view === 'analysis' && <AnalysisView claim={submittedClaim} attempt={attempt} error={error} pending={mutation.isPending} onRetry={retry} onReset={reset} onAnnounce={announceKey} />}
    {view === 'results' && result && <ResultsView result={result} inputClaim={submittedClaim} quickClaim={lastInput.current?.claim || result.claims?.[0]?.text || ''} resultLang={resultLang} timing={timing} onReset={reset} />}
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="status-wait-announcer">{announce}</div>
  </div>;
}

function toUiError(err: unknown): UiError {
  const status = (err as { status?: unknown } | null)?.status;
  if ((err instanceof Error && err.name === 'TimeoutError') || status === 504 || status === 408) {
    return { key: 'err.CHECK_TIMEOUT' };
  }
  const data = (err as { data?: unknown } | null)?.data;
  const code = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && (API_CODES as readonly string[]).includes(code)) return { key: `err.${code}` as TKey };
  if (err instanceof TypeError) return { key: 'err.network' };
  return { key: 'err.generic' };
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Experience} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><SettingsProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></SettingsProvider></TooltipProvider></QueryClientProvider>;
}

export default App;
