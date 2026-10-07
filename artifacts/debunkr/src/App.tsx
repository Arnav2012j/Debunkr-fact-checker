import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AnimatePresence, animate, motion, MotionConfig, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { toPng } from 'html-to-image';
import {
  ArrowRight, Ban, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clipboard, CloudUpload, FileImage, Flag, Globe2, Link2, LoaderCircle,
  MessageCircle, RotateCcw, Search, Share2, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { useCheckClaim } from '@workspace/api-client-react';
import type { CheckInput, CheckResult, CheckedClaim } from '@workspace/api-client-react';

const queryClient = new QueryClient();

const languages: CheckInput['language'][] = ['English', 'Hindi', 'Spanish', 'French'];
const examples = [
  'The Earth is flat',
  'Drinking lemon water cures diabetes',
  'The Great Wall of China is visible from space',
];
const rotatingExamples = [
  'A single glass of lemon water cures diabetes…',
  'The Great Wall is visible from space…',
  'The Earth is flat…',
];

function Logo() {
  return <div className="logo" aria-label="Debunkr"><span className="logo-mark"><ShieldCheck size={16} strokeWidth={2.6} /></span><span>Debunkr</span></div>;
}

function Footer() {
  return <footer className="footer">AI can make mistakes. Follow the evidence, not just the verdict.</footer>;
}

function XrayCard({ reduceMotion }: { reduceMotion: boolean }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => setPhase((v) => (v + 1) % 2), 6200);
    return () => window.clearInterval(id);
  }, [reduceMotion]);
  const trueSample = phase === 1;
  return (
    <motion.div className="xray" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .12 }}>
      <div className="xray-top"><span>MESSAGE X-RAY</span><span className="eyebrow-dot" /></div>
      <AnimatePresence mode="wait">
        <motion.div key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0, x: !trueSample && !reduceMotion ? [0, -2, 2, -1, 0] : 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .35 }}>
          <div className="xray-msg">
            {trueSample ? (
              <>The Moon is moving away from Earth by about <strong style={{ color: '#278561', background: '#e8f7ef' }}>3.8 cm each year.</strong> It’s a slow change measured with reflectors left by Apollo missions.</>
            ) : (
              <>Drinking hot water kills the virus. <strong style={{ color: '#bc344e', background: '#fff0f2' }}>Doctors don't want you to know this.</strong> <span style={{ color: '#98721d', background: '#fff7e4' }}>Share with everyone!</span></>
            )}
          </div>
          {!reduceMotion && <motion.div className="xray-line" initial={{ y: -18, opacity: 0 }} animate={{ y: [0, 170, 0], opacity: [0, 1, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }} />}
          <div className="xray-result">
            <span>{trueSample ? 'A well-supported fact' : 'Three signals worth a closer look'}</span>
            <motion.span className={trueSample ? '' : 'false-stamp'} animate={reduceMotion ? {} : trueSample ? { rotate: [-3, 3, 0], scale: [0.8, 1.06, 1] } : { rotate: [-9, 4, -4], scale: [.4, 1.08, 1] }} transition={{ duration: .55, delay: 1.1, type: 'spring', stiffness: 360, damping: 13 }} style={trueSample ? { color: '#197c56', fontWeight: 800, background: '#e7f7ef', padding: '6px 10px', borderRadius: 7 } : {}}>
              {trueSample ? 'Looks legit!' : 'FALSE'}
            </motion.span>
          </div>
          {trueSample && !reduceMotion && <div aria-hidden="true" style={{ position: 'absolute', right: 28, bottom: 30, pointerEvents: 'none' }}>{['#48b98b', '#e1c34a', '#8f82ed', '#53a87b'].map((color, i) => <motion.i key={i} style={{ display: 'inline-block', width: 5, height: 8, borderRadius: 2, background: color, margin: 3 }} initial={{ opacity: 0, y: -4, rotate: 0 }} animate={{ opacity: [0, 1, 0], y: [0, 15 + i * 2, 28], rotate: [0, 90, 180] }} transition={{ duration: .9, delay: 1 + i * .08 }} />)}</div>}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function HomeView({ onSubmit, pending }: { onSubmit: (claim: string, image?: { base64: string; mime: CheckInput['imageMime']; name: string }) => void; pending: boolean }) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<'claim' | 'image'>('claim');
  const [claim, setClaim] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [image, setImage] = useState<{ base64: string; mime: CheckInput['imageMime']; name: string; url: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setPlaceholderIndex((n) => (n + 1) % rotatingExamples.length), 3400);
    return () => window.clearInterval(timer);
  }, []);
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
  const submit = () => onSubmit(claim.trim(), image ? { base64: image.base64, mime: image.mime, name: image.name } : undefined);
  return (
    <main className="main">
      <section className="home-hero">
        <motion.div className="hero-copy" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }}>
          <div className="eyebrow"><span className="eyebrow-dot" />A calmer way to check what you see</div>
          <h1>Is it true?<br />Let’s find out.</h1>
          <p>Paste a claim or upload a screenshot. We’ll follow the evidence and help you share a grounded reply.</p>
        </motion.div>
        <XrayCard reduceMotion={!!reduceMotion} />
      </section>
      <section className="input-card" aria-label="Check a claim">
        <div className="tabs" role="tablist">
          <button className={`tab ${tab === 'claim' ? 'active' : ''}`} onClick={() => setTab('claim')} role="tab" aria-selected={tab === 'claim'} data-testid="tab-claim"><Link2 size={14} />Claim or link</button>
          <button className={`tab ${tab === 'image' ? 'active' : ''}`} onClick={() => setTab('image')} role="tab" aria-selected={tab === 'image'} data-testid="tab-image"><FileImage size={14} />Upload image</button>
        </div>
        {tab === 'claim' ? (
          <div>
            <textarea className="claim-box" value={claim} maxLength={2000} onChange={(e) => setClaim(e.target.value)} placeholder={rotatingExamples[placeholderIndex]} aria-label="Claim or link to check" data-testid="input-claim" />
            <div className="input-bottom"><span className="hint">{claim.length}/2,000 characters · Questions and links welcome</span><button className="primary-btn" disabled={pending || !claim.trim()} onClick={submit} data-testid="button-check-claim">{pending ? <LoaderCircle size={15} /> : <Search size={15} />}Check this</button></div>
          </div>
        ) : (
          <div style={{ paddingTop: 15 }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void prepareImage(e.target.files?.[0])} data-testid="input-image-file" />
            <div className={`upload-drop ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void prepareImage(e.dataTransfer.files[0]); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()} data-testid="dropzone-image">
              <div><CloudUpload size={22} /><strong>Drop a screenshot here, or browse</strong><span>PNG or JPG · resized to max 1600px before upload</span></div>
            </div>
            {image && <div className="upload-preview"><img src={image.url} alt="Selected upload preview" /><span>{image.name} · ready to check</span><button className="close-btn" aria-label="Remove uploaded image" onClick={(e) => { e.stopPropagation(); setImage(null); }} data-testid="button-remove-image"><X size={15} /></button></div>}
            <div className="input-bottom"><span className="hint">Your image is used only for this check.</span><button className="primary-btn" disabled={pending || !image} onClick={submit} data-testid="button-check-image">{pending ? <LoaderCircle size={15} /> : <Search size={15} />}Check image</button></div>
          </div>
        )}
      </section>
      <div className="examples"><span className="examples-label">Try an example</span>{examples.map((example, i) => <button key={example} className="example-chip" onClick={() => { setTab('claim'); setClaim(example); }} data-testid={`button-example-${i + 1}`}>{example}</button>)}</div>
      <section className="how">
        <h2>How it works</h2>
        <div className="how-row">
          <div className="how-item"><div className="how-icon"><Clipboard size={16} /></div><div><strong>Paste what you saw</strong><span>A message, post, headline or screenshot.</span></div></div>
          <div className="how-item"><div className="how-icon"><Globe2 size={16} /></div><div><strong>We follow the evidence</strong><span>Grounded sources, not just a confident answer.</span></div></div>
          <div className="how-item"><div className="how-icon"><MessageCircle size={16} /></div><div><strong>Share a calmer reply</strong><span>Get context you can pass along with care.</span></div></div>
        </div>
      </section>
      <Footer />
    </main>
  );
}

function AnalysisView({ claim, step, error, pending, onRetry, onReset }: { claim: string; step: number; error: string; pending: boolean; onRetry: () => void; onReset: () => void }) {
  const steps = ['Reading', 'Searching sources', 'Weighing evidence', 'Verdict'];
  return (
    <main className="main analysis">
      <div className="eyebrow" style={{ justifyContent: 'center' }}><span className="eyebrow-dot" />YOUR CHECK IS UNDERWAY</div>
      <h1 className="page-title">Let’s follow the evidence.</h1>
      <p className="page-subtitle">We’re checking this against live, grounded sources.</p>
      <motion.div className="analysis-claim" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="content-analysis-claim">
        {!window.matchMedia('(prefers-reduced-motion: reduce)').matches && <motion.div className="analysis-scan" animate={{ y: [0, 96, 0], opacity: [0, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }} />}
        {claim || 'Reading the text in your screenshot…'}
      </motion.div>
      <div className="steps" data-testid="tracker-analysis-steps">{steps.map((label, i) => <div className={`step ${i < step ? 'done' : i === step ? 'current' : ''}`} key={label}><span className="step-dot">{i < step ? <Check size={14} /> : i === step ? <LoaderCircle size={14} /> : i + 1}</span>{label}</div>)}</div>
      {!error && <><motion.div className="skeleton-card" animate={{ opacity: [.56, .95, .56] }} transition={{ duration: 1.5, repeat: Infinity }} aria-label="Loading analysis" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}><motion.div className="skeleton-card" style={{ height: 96 }} animate={{ opacity: [.6, .9, .6] }} transition={{ duration: 1.5, repeat: Infinity, delay: .2 }} /><motion.div className="skeleton-card" style={{ height: 96 }} animate={{ opacity: [.6, .9, .6] }} transition={{ duration: 1.5, repeat: Infinity, delay: .4 }} /></div></>}
      {error && <div className="error-card" role="alert" data-testid="status-check-error"><div><strong>We couldn’t finish this check.</strong><br />{error}</div><div style={{ display: 'flex', gap: 8 }}><button className="secondary-btn" onClick={onReset} data-testid="button-cancel-error">Back</button><button className="primary-btn" onClick={onRetry} disabled={pending} data-testid="button-retry-check"><RotateCcw size={14} />Try again</button></div></div>}
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

const toneNames = ['Standard', 'Like I’m 12', 'For my grandparent'] as const;
type Tone = 0 | 1 | 2;
function CountUp({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => `${Math.round(latest)}%`);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) { count.set(value); return; }
    const controls = animate(count, value, { duration: .8, ease: 'easeOut' });
    return controls.stop;
  }, [count, reduceMotion, value]);
  return <motion.span>{rounded}</motion.span>;
}
function ClaimDetail({ item, index }: { item: CheckedClaim; index: number }) {
  const [tone, setTone] = useState<Tone>(0);
  const [openTactic, setOpenTactic] = useState<number | null>(null);
  const explanation = [item.explanation, item.explanation_simple, item.explanation_elder][tone];
  const breakdown = item.evidence_breakdown;
  const total = breakdown ? Math.max(1, breakdown.supporting + breakdown.disputing + breakdown.neutral) : 1;
  const strength = Math.max(0, Math.min(100, item.evidence_strength || 0));
  const tacticDescription = (tactic: string, i: number) => item.tactic_explanations?.[i] || `${tactic} can make a claim feel more convincing without adding reliable evidence.`;
  return (
    <motion.section className="panel claim-detail" key={item.text} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .28 }} data-testid={`panel-claim-explanation-${index}`}>
      <div className="detail-top"><span className={`badge-verdict ${verdictClass(item.verdict)}`}><VerdictIcon verdict={item.verdict} size={13} />{item.verdict || 'UNCLEAR'}</span>
        <div className="tone-toggle" role="group" aria-label="Explanation style">{toneNames.map((name, i) => <button key={name} className={tone === i ? 'active' : ''} onClick={() => setTone(i as Tone)} data-testid={`button-tone-${i}`}>{name}</button>)}</div>
      </div>
      <h2 className="selected-claim">{item.text}</h2>
      {explanation && <AnimatePresence mode="wait"><motion.p key={tone} className="explanation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} data-testid={`text-explanation-${index}`}>{explanation}</motion.p></AnimatePresence>}
      <div className="meter-title"><span>Evidence strength</span><span className="evidence-number" data-testid={`text-evidence-strength-${index}`}><CountUp value={strength} /></span></div>
      <div className="meter-track"><motion.div className="meter-fill" initial={{ scaleX: 0 }} animate={{ scaleX: strength / 100 }} transition={{ duration: .9, delay: .12 }} /></div>
      {breakdown && <div className="agreement"><div className="meter-title"><span>Evidence agreement</span><span>{total} sources</span></div><div className="agreement-bar" data-testid={`bar-evidence-agreement-${index}`}><motion.span className="support" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.supporting / total * 100}%`, transformOrigin: 'left' }} /><motion.span className="dispute" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.disputing / total * 100}%`, transformOrigin: 'left' }} /><motion.span className="neutral" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ width: `${breakdown.neutral / total * 100}%`, transformOrigin: 'left' }} /></div><div className="agreement-legend"><span>Supporting · {breakdown.supporting}</span><span>Disputing · {breakdown.disputing}</span><span>Neutral · {breakdown.neutral}</span></div></div>}
      {!!item.red_flags?.length && <div className="detail-section"><h3>Red flags to notice</h3>{item.red_flags.map((flag, i) => <div className="redflag" key={`${flag}-${i}`}><Flag size={13} />{flag}</div>)}</div>}
      {!!item.tactics?.length && <div className="detail-section"><h3>Persuasion tactics</h3><div className="tactics">{item.tactics.map((tactic, i) => <div className="tactic-wrap" key={`${tactic}-${i}`}><button className="tactic" onClick={() => setOpenTactic(openTactic === i ? null : i)} data-testid={`button-tactic-${index}-${i}`}><Sparkles size={11} />{tactic}<ChevronDown size={11} /></button><AnimatePresence>{openTactic === i && <motion.div className="tactic-pop" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>{tacticDescription(tactic, i)}</motion.div>}</AnimatePresence></div>)}</div></div>}
      {item.why_it_spreads && <div className="detail-section"><h3>Why does this spread?</h3><div className="why-card">{item.why_it_spreads}</div></div>}
      {!!item.sources?.length && <div className="detail-section"><h3>Grounded sources</h3>{item.sources.map((source, i) => <motion.a className="source-card" key={`${source.url}-${i}`} href={source.url} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .12 }} data-testid={`card-source-${index}-${i}`}><div className="source-meta"><span className="source-type">{source.type}</span><ArrowRight size={13} color="#8a86a0" /></div><div className="source-title">{source.title}</div><div className="source-publisher">{source.publisher}</div><div className="source-url">{source.url}</div></motion.a>)}</div>}
    </motion.section>
  );
}

function ShareModal({ result, claim, selected, onClose }: { result: CheckResult; claim: CheckedClaim; selected: number; onClose: () => void }) {
  const [notice, setNotice] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const mood = verdictClass(result.overall_verdict);
  const sources = claim.sources?.slice(0, 2).map((s) => s.publisher || s.title).filter(Boolean) ?? [];
  const reason = claim.explanation?.split(/[.!?]/)[0] || result.summary || 'Follow the evidence before sharing this claim.';
  const copyText = `${claim.text}\n\n${result.overall_verdict}: ${reason}.\nChecked with Debunkr.`;
  const shareText = async () => {
    try { await navigator.clipboard.writeText(copyText); setNotice('The share text has been copied.'); }
    catch { setNotice('Clipboard access is unavailable in this browser.'); }
  };
  const downloadPng = async () => {
    const card = cardRef.current;
    if (!card) { setNotice('Could not create the share image.'); return; }
    setIsDownloading(true);
    try {
      const pixelRatio = 1080 / Math.max(1, card.getBoundingClientRect().width);
      const dataUrl = await toPng(card, { cacheBust: true, pixelRatio });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'debunkr-check.png';
      link.click();
      setNotice('Your 1080 × 1080 card has been downloaded.');
    } catch {
      setNotice('Could not create the share image. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };
  const nativeShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Debunkr fact check', text: copyText }); setNotice('Shared successfully.'); }
      catch (e) { if (e instanceof Error && e.name !== 'AbortError') setNotice('Sharing is unavailable right now.'); }
    } else await shareText();
  };
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="modal-share">
    <motion.div className="modal" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="modal-head"><h2 id="share-title">A grounded reply, ready to share.</h2><button className="close-btn" onClick={onClose} aria-label="Close share dialog" data-testid="button-close-share"><X size={17} /></button></div>
      <div className="share-layout">
        <div ref={cardRef} className="share-canvas" data-testid="preview-share-card"><div><Logo /><span className={`badge-verdict ${mood}`} style={{ marginTop: 34 }}><VerdictIcon verdict={result.overall_verdict} />{result.overall_verdict}</span><div className="share-claim">{claim.text}</div><div className="share-reason">{reason}.</div><div style={{ marginTop: 18, fontSize: 12, fontWeight: 800, color: mood === 'false' ? '#b72f4b' : mood === 'true' ? '#18794f' : '#9b7118' }}>Evidence strength · {claim.evidence_strength || 0}%</div></div><div className="share-bottom">{sources.length ? `Sources: ${sources.join(' · ')}  |  ` : ''}Checked with Debunkr. AI can make mistakes.</div></div>
        <div className="share-actions"><p>Make a square card with the claim, verdict, evidence and sources. Share it with the context attached.</p><button className="primary-btn" onClick={() => void downloadPng()} disabled={isDownloading} data-testid="button-download-share">{isDownloading ? <LoaderCircle size={15} /> : <FileImage size={15} />}{isDownloading ? 'Rendering…' : 'Download PNG'}</button><button className="secondary-btn" onClick={() => void shareText()} data-testid="button-copy-share"><Clipboard size={15} />Copy text</button><button className="secondary-btn" onClick={() => void nativeShare()} data-testid="button-native-share"><Share2 size={15} />Share</button>{notice && <div role="status" style={{ fontSize: 11, color: '#625b7d' }} data-testid="status-share">{notice}</div>}</div>
      </div>
    </motion.div>
  </motion.div>;
}

function ResultsView({ result, inputClaim, onReset }: { result: CheckResult; inputClaim: string; onReset: () => void }) {
  const [selected, setSelected] = useState(0);
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
  return <main className={`main results mood-${mood}`} data-testid="content-results">
    <div className="results-head"><div><div className="eyebrow"><span className="eyebrow-dot" />CHECK COMPLETE</div><h1>{result.overall_verdict === 'TRUE' ? 'The evidence checks out.' : result.overall_verdict === 'FALSE' ? 'This claim is dangerous.' : 'Not enough evidence yet.'}</h1></div><button className="share-btn" onClick={() => setShareOpen(true)} data-testid="button-open-share"><Share2 size={14} />Share result</button></div>
    <motion.div className={`verdict-hero ${mood}`} initial={{ opacity: 0, y: 12 }} animate={mood === 'false' ? { opacity: 1, y: [0, 3, -2, 0] } : { opacity: 1, y: 0 }} transition={{ duration: mood === 'false' ? .36 : .3 }} data-testid="status-overall-verdict">
      <div><div className="verdict-label"><VerdictIcon verdict={result.overall_verdict} size={21} />{result.overall_verdict === 'TRUE' ? 'Looks legit!' : result.overall_verdict === 'FALSE' ? 'This claim is dangerous.' : 'Not enough evidence yet.'}</div><p>{result.summary || 'Here is what the available evidence says about this claim.'}</p></div><div className="action-line">{result.action || 'Wait for more evidence'}</div>
      {result.overall_verdict === 'FALSE' && <motion.div className="verdict-stamp" initial={{ scale: .45, rotate: -15, opacity: 0 }} animate={{ scale: 1, rotate: -8, opacity: .28 }} transition={{ type: 'spring', stiffness: 310, damping: 14, delay: .16 }}>FALSE</motion.div>}
      {result.overall_verdict === 'TRUE' && <div className="verdict-confetti" aria-hidden="true">{['#7ab966', '#e1bd49', '#42a982', '#baa7df', '#dba85b'].map((color, i) => <motion.i key={i} style={{ background: color }} initial={{ opacity: 0, y: -5, rotate: 0 }} animate={{ opacity: [0, .9, 0], y: [0, 28 + i * 3, 52], rotate: [0, 70, 150] }} transition={{ duration: .9, delay: i * .07 }} />)}</div>}
    </motion.div>
    <div className="results-grid">
      <section className="panel panel-pad">
        <h2 className="panel-title">Your message, examined</h2>
        <p className="original-text" data-testid="text-original-claim">{renderHighlighted()}</p>
        <div style={{ marginTop: 17 }}><h3 className="panel-title" style={{ marginBottom: 8 }}>Claims found · choose one to inspect</h3>
          {result.claims?.map((item, i) => <button key={`${item.text}-${i}`} className={`claim-select ${i === selected ? 'selected' : ''}`} onClick={() => setSelected(i)} data-testid={`button-select-claim-${i}`}><span className={`claim-verdict ${verdictClass(item.verdict)}`} style={{ color: item.verdict === 'TRUE' ? '#18794f' : item.verdict === 'FALSE' ? '#b72f4b' : '#9b7118' }}><VerdictIcon verdict={item.verdict} size={13} />{item.verdict}</span>{item.text}</button>)}
        </div>
        {result.calm_reply && <div className="reply-card"><h3 className="panel-title" style={{ marginBottom: 7 }}>A calm reply to share</h3><p>{result.calm_reply}</p><div className="reply-actions"><button className="primary-btn" onClick={() => void copyReply()} data-testid="button-copy-calm-reply">{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? 'Copied' : 'Copy a calm reply'}</button></div></div>}
        <button onClick={onReset} className="secondary-btn" style={{ marginTop: 12 }} data-testid="button-new-check"><RotateCcw size={14} />Check another</button>
      </section>
      {selectedClaim ? <ClaimDetail item={selectedClaim} index={selected} /> : <div className="panel panel-pad"><h2 className="panel-title">Claim details</h2><p className="original-text">No individual claim details were returned. Please try another check.</p></div>}
    </div>
    <Footer />
    <AnimatePresence>{shareOpen && selectedClaim && <ShareModal result={result} claim={selectedClaim} selected={selected} onClose={() => setShareOpen(false)} />}</AnimatePresence>
  </main>;
}

function Experience() {
  const [view, setView] = useState<'home' | 'analysis' | 'results'>('home');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [submittedClaim, setSubmittedClaim] = useState('');
  const [error, setError] = useState('');
  const [analysisStep, setAnalysisStep] = useState(0);
  const [language, setLanguage] = useState<CheckInput['language']>('English');
  const mutation = useCheckClaim();
  const lastInput = useRef<CheckInput | null>(null);
  const stepsTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!mutation.isPending) return;
    setAnalysisStep(0);
    stepsTimer.current = window.setInterval(() => setAnalysisStep((s) => Math.min(3, s + 1)), 1350);
    return () => window.clearInterval(stepsTimer.current);
  }, [mutation.isPending]);
  const submitInput = (claim: string, image?: { base64: string; mime: CheckInput['imageMime']; name: string }) => {
    const cleaned = claim.trim();
    if (!cleaned && !image) { setError('Add a claim, link or image to begin.'); return; }
    if (cleaned.length > 2000) { setError('Please keep your claim under 2,000 characters.'); return; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) {
      try { const url = new URL(cleaned); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { setError('That link does not look valid. Use a full http or https URL.'); return; }
    }
    setError('');
    setResult(null);
    setSubmittedClaim(cleaned || image?.name || 'Text in uploaded image');
    const input: CheckInput = { language, ...(cleaned ? { claim: cleaned } : {}), ...(image ? { imageBase64: image.base64, imageMime: image.mime } : {}) };
    lastInput.current = input;
    setView('analysis');
    mutation.mutate({ data: input }, {
      onSuccess: (data) => { setResult(data); setAnalysisStep(4); setView('results'); },
      onError: (err) => { setError(err instanceof Error ? err.message : 'The check could not be completed. Please try again.'); setView('analysis'); },
    });
  };
  const retry = () => {
    if (!lastInput.current) { setView('home'); return; }
    setError('');
    setView('analysis');
    mutation.mutate({ data: lastInput.current }, {
      onSuccess: (data) => { setResult(data); setView('results'); },
      onError: (err) => setError(err instanceof Error ? err.message : 'The check could not be completed. Please try again.'),
    });
  };
  const reset = () => { setView('home'); setError(''); setResult(null); setSubmittedClaim(''); mutation.reset(); };
  return <div className="shell">
    <header className="topbar"><button onClick={reset} style={{ border: 0, background: 'transparent', padding: 0 }} data-testid="button-logo-home"><Logo /></button><div className="nav-right"><button className="nav-link" onClick={reset} data-testid="link-fact-check">Fact check</button><label style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span className="sr-only">Select language</span><select className="language" value={language} onChange={(e) => setLanguage(e.target.value as CheckInput['language'])} aria-label="Language" data-testid="select-language">{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div></header>
    {view === 'home' && <HomeView onSubmit={submitInput} pending={mutation.isPending} />}
    {view === 'analysis' && <AnalysisView claim={submittedClaim} step={analysisStep} error={error} pending={mutation.isPending} onRetry={retry} onReset={reset} />}
    {view === 'results' && result && <ResultsView result={result} inputClaim={submittedClaim} onReset={reset} />}
  </div>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Experience} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><MotionConfig reducedMotion="user"><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></MotionConfig></TooltipProvider></QueryClientProvider>;
}

export default App;
