import { type ReactNode, useEffect, useRef, useState } from 'react';
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
import { LANGS, type Lang, type Tone } from '@/settings/settings-store';
import { LANGUAGE_NAMES, translate, type TKey } from '@/settings/translations';
import { CheckAnywhere, CopyQuickLinkButton, MicButton, SpeakButton } from '@/features/FeatureUI';
import { useSpeechInput } from '@/features/use-speech-input';
import { stopSpeech } from '@/features/speech-synth';
import { readQuickParams, takeAutoRun } from '@/features/quick-link';
import '@/features/features.css';
import { useCheckClaim } from '@workspace/api-client-react';
import type { CheckInput, CheckResult, CheckedClaim } from '@workspace/api-client-react';

const queryClient = new QueryClient();

const exampleKeys: TKey[] = ['home.ex1', 'home.ex2', 'home.ex3'];
const placeholderKeys: TKey[] = ['home.ph1', 'home.ph2', 'home.ph3'];
type UiError = { key: TKey } | null;
const API_CODES = ['INVALID_INPUT', 'INVALID_URL', 'INVALID_IMAGE', 'RATE_LIMIT_REACHED', 'KEY_MISSING', 'GEMINI_RATE_LIMITED', 'INVALID_KEY', 'GEMINI_ERROR', 'UNREADABLE_RESPONSE', 'INTERNAL_ERROR', 'REQUEST_TOO_LARGE'] as const;

function Logo() {
  return <div className="logo" aria-label="Debunkr"><span className="logo-mark"><ShieldCheck size={16} strokeWidth={2.6} /></span><span>Debunkr</span></div>;
}

function Footer() {
  const t = useT();
  return <footer className="footer">{t('footer')}</footer>;
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
      <section className={`home-hero ${settings.showHero ? '' : 'no-hero'}`}>
        <motion.div className="hero-copy" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }}>
          <div className="eyebrow"><span className="eyebrow-dot" />{t('home.eyebrow')}</div>
          <h1>{t('home.title1')}<br />{t('home.title2')}</h1>
          <p>{t('home.body')}</p>
        </motion.div>
        {settings.showHero && <XrayCard />}
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
      </section>
      <div className="examples"><span className="examples-label">{t('home.tryExample')}</span>{exampleKeys.map((key, i) => <button key={key} className="example-chip" onClick={() => { setTab('claim'); setClaim(t(key)); }} data-testid={`button-example-${i + 1}`}>{t(key)}</button>)}</div>
      <section className="how">
        <h2>{t('how.title')}</h2>
        <div className="how-row">
          <div className="how-item"><div className="how-icon"><Clipboard size={16} /></div><div><strong>{t('how.t1')}</strong><span>{t('how.b1')}</span></div></div>
          <div className="how-item"><div className="how-icon"><Globe2 size={16} /></div><div><strong>{t('how.t2')}</strong><span>{t('how.b2')}</span></div></div>
          <div className="how-item"><div className="how-icon"><MessageCircle size={16} /></div><div><strong>{t('how.t3')}</strong><span>{t('how.b3')}</span></div></div>
        </div>
      </section>
      <CheckAnywhere />
      <Footer />
    </main>
  );
}

function AnalysisView({ claim, step, error, pending, onRetry, onReset }: { claim: string; step: number; error: UiError; pending: boolean; onRetry: () => void; onReset: () => void }) {
  const t = useT();
  const reduceMotion = useMotionOff();
  const steps = [t('an.s1'), t('an.s2'), t('an.s3'), t('an.s4')];
  return (
    <main className="main analysis">
      <div className="eyebrow" style={{ justifyContent: 'center' }}><span className="eyebrow-dot" />{t('an.eyebrow')}</div>
      <h1 className="page-title">{t('an.title')}</h1>
      <p className="page-subtitle">{t('an.sub')}</p>
      <motion.div className="analysis-claim" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="content-analysis-claim">
        {!reduceMotion && <motion.div className="analysis-scan" animate={{ y: [0, 96, 0], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }} />}
        {claim || t('an.screenshot')}
      </motion.div>
      <div className="steps" data-testid="tracker-analysis-steps">{steps.map((label, i) => <div className={`step ${i < step ? 'done' : i === step ? 'current' : ''}`} key={label}><span className="step-dot">{i < step ? <Check size={14} /> : i === step ? <LoaderCircle size={14} /> : i + 1}</span>{label}</div>)}</div>
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
function ClaimDetail({ item, index, tone, setTone, speech, lang }: { item: CheckedClaim; index: number; tone: Tone; setTone: (t: Tone) => void; speech: string; lang: Lang }) {
  const t = useT();
  const [openTactic, setOpenTactic] = useState<number | null>(null);
  const explanation = [item.explanation, item.explanation_simple, item.explanation_elder][tone];
  const breakdown = item.evidence_breakdown;
  const total = breakdown ? Math.max(1, breakdown.supporting + breakdown.disputing + breakdown.neutral) : 1;
  const sourceCount = item.sources?.length ?? 0;
  const strength = Math.max(0, Math.min(100, item.evidence_strength || 0));
  const tacticDescription = (tactic: string, i: number) => item.tactic_explanations?.[i] || t('res.tacticFallback', { tactic });
  return (
    <motion.section className="panel claim-detail" key={item.text} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .28 }} data-testid={`panel-claim-explanation-${index}`}>
      <div className="detail-top"><span className={`badge-verdict ${verdictClass(item.verdict)}`}><VerdictIcon verdict={item.verdict} size={13} />{t(verdictKey(item.verdict))}</span>
        <div className="tone-toggle" role="group" aria-label={t('tone.label')}>{toneKeys.map((key, i) => <button key={key} className={tone === i ? 'active' : ''} aria-pressed={tone === i} onClick={() => setTone(i as Tone)} data-testid={`button-tone-${i}`}>{t(key)}</button>)}</div>
      </div>
      <h2 className="selected-claim">{item.text}</h2>
      <div className="detail-speak"><SpeakButton id={`claim-${index}`} text={speech} lang={lang} ariaKey="read.claimAria" testId={`button-read-claim-${index}`} /></div>
      {explanation && <AnimatePresence mode="wait"><motion.p key={tone} className="explanation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} data-testid={`text-explanation-${index}`}>{explanation}</motion.p></AnimatePresence>}
      <div className="meter-title"><span>{t('res.strength')}</span><span className="evidence-number" data-testid={`text-evidence-strength-${index}`}><CountUp value={strength} /></span></div>
      <div className="meter-track"><motion.div className="meter-fill" initial={{ scaleX: 0 }} animate={{ scaleX: strength / 100 }} transition={{ duration: .9, delay: .12 }} /></div>
      {breakdown && <div className="agreement"><div className="meter-title"><span>{t('res.agreement')}</span><span>{t('res.sources', { n: sourceCount })}</span></div><div className="agreement-bar" data-testid={`bar-evidence-agreement-${index}`}><motion.span className="support" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.supporting / total * 100}%`, transformOrigin: 'left' }} /><motion.span className="dispute" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.disputing / total * 100}%`, transformOrigin: 'left' }} /><motion.span className="neutral" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.neutral / total * 100}%`, transformOrigin: 'left' }} /></div><div className="agreement-legend"><span>{t('res.supporting', { n: breakdown.supporting })}</span><span>{t('res.disputing', { n: breakdown.disputing })}</span><span>{t('res.neutral', { n: breakdown.neutral })}</span></div></div>}
      {!!item.red_flags?.length && <div className="detail-section"><h3>{t('res.redFlags')}</h3>{item.red_flags.map((flag, i) => <div className="redflag" key={`${flag}-${i}`}><Flag size={13} />{flag}</div>)}</div>}
      {!!item.tactics?.length && <div className="detail-section"><h3>{t('res.tactics')}</h3><div className="tactics">{item.tactics.map((tactic, i) => <div className="tactic-wrap" key={`${tactic}-${i}`}><button className="tactic" onClick={() => setOpenTactic(openTactic === i ? null : i)} data-testid={`button-tactic-${index}-${i}`}><Tag size={11} />{tactic}<ChevronDown size={11} /></button><AnimatePresence>{openTactic === i && <motion.div className="tactic-pop" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>{tacticDescription(tactic, i)}</motion.div>}</AnimatePresence></div>)}</div></div>}
      {item.why_it_spreads && <div className="detail-section"><h3>{t('res.why')}</h3><div className="why-card">{item.why_it_spreads}</div></div>}
      {!!item.sources?.length && <div className="detail-section"><h3>{t('res.grounded')}</h3>{item.sources.map((source, i) => <motion.a className="source-card" key={`${source.url}-${i}`} href={source.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .12 }} data-testid={`card-source-${index}-${i}`}><div className="source-meta"><span className="source-type">{source.type}</span><ArrowRight size={13} className="source-arrow" /></div><div className="source-title">{source.title}</div><div className="source-publisher">{source.publisher}</div><div className="source-url">{source.url}</div></motion.a>)}</div>}
    </motion.section>
  );
}

function ShareModal({ result, claim, selected, onClose }: { result: CheckResult; claim: CheckedClaim; selected: number; onClose: () => void }) {
  const t = useT();
  const [notice, setNotice] = useState<TKey | ''>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const mood = verdictClass(result.overall_verdict);
  const sources = claim.sources?.slice(0, 2).map((s) => s.publisher || s.title).filter(Boolean) ?? [];
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

function ResultsView({ result, inputClaim, quickClaim, resultLang, onReset }: { result: CheckResult; inputClaim: string; quickClaim: string; resultLang: Lang; onReset: () => void }) {
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
  return <main className={`main results mood-${mood}`} data-testid="content-results">
    <div className="results-head"><div><div className="eyebrow"><span className="eyebrow-dot" />{t('res.complete')}</div><h1>{result.overall_verdict === 'TRUE' ? t('res.headTrue') : result.overall_verdict === 'FALSE' ? t('res.headFalse') : t('res.headUnclear')}</h1></div><button className="share-btn" onClick={() => setShareOpen(true)} data-testid="button-open-share"><Share2 size={14} />{t('res.share')}</button></div>
    <p className="next-note" data-testid="text-next-check-note">{t('res.nextNote')}</p>
    <motion.div className={`verdict-hero ${mood}`} initial={{ opacity: 0, y: 12 }} animate={mood === 'false' && !reduceMotion ? { opacity: 1, y: [0, 3, -2, 0] } : { opacity: 1, y: 0 }} transition={{ duration: mood === 'false' ? .36 : .3 }} data-testid="status-overall-verdict">
      <div><div className="verdict-label"><VerdictIcon verdict={result.overall_verdict} size={21} />{result.overall_verdict === 'TRUE' ? t('res.legit') : result.overall_verdict === 'FALSE' ? t('res.headFalse') : t('res.headUnclear')}</div><p>{result.summary || t('res.summaryFallback')}</p></div><div className="verdict-tools"><div className="action-line">{result.action || t('res.actionFallback')}</div><SpeakButton id="overall" text={overallSpeech} lang={resultLang} ariaKey="read.overallAria" testId="button-read-overall" /></div>
      {result.overall_verdict === 'FALSE' && <motion.div className="verdict-stamp" initial={reduceMotion ? { scale: 1, rotate: -8, opacity: 0 } : { scale: .45, rotate: -15, opacity: 0 }} animate={{ scale: 1, rotate: -8, opacity: .28 }} transition={{ type: 'spring', stiffness: 310, damping: 14, delay: .16 }}>{t('verdict.FALSE')}</motion.div>}
      {result.overall_verdict === 'TRUE' && !reduceMotion && <div className="verdict-confetti" aria-hidden="true">{['var(--d-v-true)', 'var(--d-vi-true)', 'var(--d-v-true)', 'var(--d-ink)', 'var(--d-v-true)'].map((color, i) => <motion.i key={i} style={{ background: color }} initial={{ opacity: 0, y: -5, rotate: 0 }} animate={{ opacity: [0, .9, 0], y: [0, 28 + i * 3, 52], rotate: [0, 70, 150] }} transition={{ duration: .9, delay: i * .07 }} />)}</div>}
    </motion.div>
    <div className="results-grid">
      <section className="panel panel-pad">
        <h2 className="panel-title">{t('res.examined')}</h2>
        <p className="original-text" data-testid="text-original-claim">{renderHighlighted()}</p>
        <div style={{ marginTop: 17 }}><h3 className="panel-title" style={{ marginBottom: 8 }}>{t('res.claimsFound')}</h3>
          {result.claims?.map((item, i) => <button key={`${item.text}-${i}`} className={`claim-select ${i === selected ? 'selected' : ''}`} onClick={() => setSelected(i)} data-testid={`button-select-claim-${i}`}><span className={`claim-verdict ${verdictClass(item.verdict)}`}><VerdictIcon verdict={item.verdict} size={13} />{t(verdictKey(item.verdict))}</span>{item.text}</button>)}
        </div>
        {result.calm_reply && <div className="reply-card"><h3 className="panel-title" style={{ marginBottom: 7 }}>{t('res.calmReply')}</h3><p>{result.calm_reply}</p><div className="reply-actions"><button className="primary-btn" onClick={() => void copyReply()} data-testid="button-copy-calm-reply">{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? t('res.copied') : t('res.copyReply')}</button></div></div>}
        <CopyQuickLinkButton claim={quickClaim} lang={resultLang} />
        <button onClick={onReset} className="secondary-btn" style={{ marginTop: 12 }} data-testid="button-new-check"><RotateCcw size={14} />{t('res.another')}</button>
      </section>
      {selectedClaim ? <ClaimDetail key={selected} item={selectedClaim} index={selected} tone={tone} setTone={setTone} speech={claimSpeech} lang={resultLang} /> : <div className="panel panel-pad"><h2 className="panel-title">{t('res.noDetailsTitle')}</h2><p className="original-text">{t('res.noDetails')}</p></div>}
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
  const [analysisStep, setAnalysisStep] = useState(0);
  const { settings, update, t } = useSettings();
  const language = settings.language;
  const [quick] = useState(readQuickParams);
  const [prefill, setPrefill] = useState(quick.claim);
  const [resultLang, setResultLang] = useState<Lang>(language);
  const mutation = useCheckClaim();
  const lastInput = useRef<CheckInput | null>(null);
  const stepsTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!mutation.isPending) return;
    setAnalysisStep(0);
    stepsTimer.current = window.setInterval(() => setAnalysisStep((s) => Math.min(3, s + 1)), 1350);
    return () => window.clearInterval(stepsTimer.current);
  }, [mutation.isPending]);
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
    mutation.mutate({ data: input }, {
      onSuccess: (data) => { setResult(data); setAnalysisStep(4); setView('results'); },
      onError: (err) => { setError(toUiError(err)); setView('analysis'); },
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
    mutation.mutate({ data: lastInput.current }, {
      onSuccess: (data) => { setResult(data); setView('results'); },
      onError: (err) => setError(toUiError(err)),
    });
  };
  const reset = () => { stopSpeech(); setView('home'); setError(null); setResult(null); setSubmittedClaim(''); mutation.reset(); };
  const mood = view === 'results' && result ? verdictClass(result.overall_verdict) : undefined;
  return <div className="shell" data-mood={mood}>
    <header className="topbar"><button onClick={reset} style={{ border: 0, background: 'transparent', padding: 0, minHeight: 44 }} aria-label={t('nav.home')} data-testid="button-logo-home"><Logo /></button><div className="nav-right"><button className="nav-link" onClick={reset} data-testid="link-fact-check">{t('nav.factCheck')}</button><label style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span className="sr-only">{t('nav.language')}</span><select className="language" value={language} onChange={(e) => update('language', e.target.value as Lang)} aria-label={t('nav.language')} data-testid="select-language">{LANGS.map((value) => <option key={value} value={value}>{LANGUAGE_NAMES[value]}</option>)}</select></label><SettingsButton /></div></header>
    {view === 'home' && <HomeView onSubmit={submitInput} pending={mutation.isPending} initialClaim={prefill} />}
    {view === 'analysis' && <AnalysisView claim={submittedClaim} step={analysisStep} error={error} pending={mutation.isPending} onRetry={retry} onReset={reset} />}
    {view === 'results' && result && <ResultsView result={result} inputClaim={submittedClaim} quickClaim={lastInput.current?.claim || result.claims?.[0]?.text || ''} resultLang={resultLang} onReset={reset} />}
  </div>;
}

function toUiError(err: unknown): UiError {
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
