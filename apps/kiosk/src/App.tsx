/**
 * AAYNA Entrance Gate — hands-free shopper scan.
 *
 * Replaces the interactive kiosk flow: an entrance camera watches continuously,
 * detects anyone walking through, auto-captures their best frame + measurements.
 * The RFID band is read at the same gate (USB readers act as keyboards — their
 * keystrokes land in the global band buffer). When both scan and band exist,
 * the session is linked automatically. Zero shopper interaction.
 *
 * Consent: pilot signage mode — the entrance notice ("By entering you agree…")
 * is the opt-in; logged automatically as consent_given with no profile save.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Scan,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { GateScanner } from './capture';
import { createSession, postConsent, postBodyModel, uploadPersonFrame } from './api';

type Phase = 'boot' | 'watching' | 'capturing' | 'linking' | 'done';

const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';
/** Single-camera height can't be measured absolutely; population default,
 *  overridable per venue via env. Measurements stay ratio-accurate. */
const DEFAULT_HEIGHT_CM = Number(import.meta.env.VITE_GATE_DEFAULT_HEIGHT_CM ?? 170);

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [error, setError] = useState<string | null>(null);
  const [linkedBand, setLinkedBand] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<GateScanner>(new GateScanner());
  // Scan result and band ID can arrive in either order — stash until both exist.
  const scanRef = useRef<{ frameBase64: string; measurements: Record<string, unknown> } | null>(null);
  const bandRef = useRef<string>('');
  const linkingRef = useRef(false);

  /** Commit a band tap: typed by a USB RFID reader or simulated in dev. */
  const submitBand = useCallback((rawId: string) => {
    const id = rawId.trim();
    if (!id) return;
    bandRef.current = id;
    void tryLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryLink = useCallback(async () => {
    if (linkingRef.current || !scanRef.current || !bandRef.current) return;
    linkingRef.current = true;
    setPhase('linking');
    try {
      const { session_id: sessionId } = await createSession(TENANT_ID, bandRef.current);
      // Pilot signage-consent mode: entrance notice is the opt-in.
      await postConsent(sessionId, true, false);
      await postBodyModel(sessionId, { ...scanRef.current.measurements });
      await uploadPersonFrame(sessionId, scanRef.current.frameBase64);
      setLinkedBand(bandRef.current);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('watching');
    } finally {
      linkingRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    scanRef.current = null;
    bandRef.current = '';
    setLinkedBand('');
    setError(null);
    setPhase('watching');
  }, []);

  // Boot the entrance camera once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await scannerRef.current.start(videoRef.current!);
        if (!cancelled) setPhase('watching');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      scannerRef.current.stop();
    };
  }, []);

  // Watching loop: require a stable full-body detection before triggering.
  useEffect(() => {
    if (phase !== 'watching') return;
    let raf = 0;
    let streak = 0;
    const tick = () => {
      const hit = scannerRef.current.poll();
      streak = hit ? streak + 1 : Math.max(0, streak - 1);
      if (streak >= 4) {
        setPhase('capturing');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Capturing: burst across the crossing window, keep the best frame.
  useEffect(() => {
    if (phase !== 'capturing') return;
    let cancelled = false;
    (async () => {
      try {
        const result = await scannerRef.current.captureBest(DEFAULT_HEIGHT_CM);
        if (cancelled) return;
        scanRef.current = { frameBase64: result.frameBase64, measurements: { ...result.measurements } };
        void tryLink(); // band may already have been read
        if (!bandRef.current) setPhase((p) => (p === 'capturing' ? 'linking' : p));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('watching');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, tryLink]);

  // Global keydown buffer — USB RFID readers emulate keyboards (digits + Enter).
  useEffect(() => {
    let buf = '';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (buf.length >= 3) submitBand(buf);
        buf = '';
      } else if (/^[a-zA-Z0-9-]$/.test(e.key)) {
        buf += e.key;
      } else if (e.key === 'Backspace') {
        buf = buf.slice(0, -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitBand]);

  // Done screen auto-resets for the next walker.
  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(reset, 6000);
    return () => clearTimeout(t);
  }, [phase, reset]);

  return (
    <div className="relative min-h-screen bg-gray-950 text-white overflow-hidden">
      {/* Live entrance feed fills the screen */}
      <video ref={videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950/90 via-transparent to-gray-950/60 pointer-events-none" />

      {/* Scan-line sweep while watching */}
      {phase === 'watching' && (
        <div className="absolute inset-x-0 top-0 h-full overflow-hidden pointer-events-none">
          <div className="gate-sweep absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-purple-400/70 to-transparent" />
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center justify-end min-h-screen p-10 pb-14">
        {/* ── Boot ── */}
        {phase === 'boot' && (
          <div className="flex items-center gap-3 text-purple-200">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-lg">Starting entrance camera…</span>
          </div>
        )}

        {/* ── Watching ── */}
        {phase === 'watching' && (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur mb-4">
              <Radio className="w-4 h-4 text-green-400 animate-pulse" />
              <span className="text-sm tracking-wide">GATE ACTIVE</span>
            </div>
            <h1 className="text-5xl font-bold mb-3">
              Walk on in — <span className="aayna-gradient-text">we'll do the rest</span>
            </h1>
            <p className="text-gray-300 max-w-xl mx-auto">
              Our entrance camera measures your style profile as you pass. Tap your band at any
              mirror to see outfits on you.
            </p>
            {error && (
              <div className="mt-5 inline-flex items-start gap-2 bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-3 text-left">
                <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
                <p className="text-sm text-red-100">{error}</p>
              </div>
            )}
            <button
              onClick={() => submitBand(`band-${crypto.randomUUID().slice(0, 8)}`)}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Simulate band tap (dev)
            </button>
          </div>
        )}

        {/* ── Capturing ── */}
        {phase === 'capturing' && (
          <div className="text-center">
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-purple-600/80 backdrop-blur">
              <Scan className="w-5 h-5 animate-pulse" />
              <span className="text-lg font-medium tracking-wide">Scanning… keep walking</span>
            </div>
          </div>
        )}

        {/* ── Linking ── */}
        {phase === 'linking' && (
          <div className="text-center">
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-blue-600/80 backdrop-blur">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-lg font-medium tracking-wide">Scan captured — waiting for band…</span>
            </div>
            <button
              onClick={() => submitBand(`band-${crypto.randomUUID().slice(0, 8)}`)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Simulate band tap (dev)
            </button>
          </div>
        )}

        {/* ── Done ── */}
        {phase === 'done' && (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center shadow-lg">
              <CheckCircle2 className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-4xl font-bold mb-3">You're all set!</h1>
            <p className="text-gray-300 mb-4">
              Your band <code className="font-bold aayna-gradient-text">{linkedBand}</code> is linked.
              Head to any mirror and pick up what you like.
            </p>
            <p className="text-xs text-gray-500">Resetting for next shopper…</p>
          </div>
        )}

        {/* Consent signage notice — the pilot's opt-in mechanism */}
        <div className="absolute bottom-4 inset-x-0 flex justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 text-[11px] text-gray-400">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            Entrance signage applies: body-proportion scan only — no facial data stored, frames
            deleted after each use.
          </div>
        </div>
      </div>
    </div>
  );
}
