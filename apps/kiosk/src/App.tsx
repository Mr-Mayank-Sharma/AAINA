import { useRef, useState } from 'react';
import {
  Scan,
  ShieldCheck,
  Camera,
  CheckCircle2,
  Sparkles,
  Clock,
  Copy,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { WebcamCapture } from './capture';
import { createSession, postConsent, postBodyModel, uploadPersonFrame } from './api';

type Screen = 'welcome' | 'consent' | 'scan' | 'done';

const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';

const STEPS = [
  { label: 'Welcome', icon: Sparkles },
  { label: 'Your Choice', icon: ShieldCheck },
  { label: 'Scan', icon: Scan },
  { label: 'Ready', icon: CheckCircle2 },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  done
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white'
                    : active
                      ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white ring-4 ring-purple-200'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                <step.icon className="w-5 h-5" />
              </div>
              <span className={`text-xs mt-1.5 font-medium ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-0.5 mx-2 mb-5 ${done ? 'bg-purple-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [consent, setConsent] = useState(false);
  const [saveProfile, setSaveProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bandId, setBandId] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<WebcamCapture>(new WebcamCapture());

  const stepIndex = { welcome: 0, consent: 1, scan: 2, done: 3 }[screen];

  async function startScan() {
    setBusy(true);
    setError(null);
    try {
      // Mount the video element first.
      setScreen('scan');
      await new Promise((r) => setTimeout(r, 50));

      // Screen 3 order per spec: session → consent → body-model → frame upload.
      const rfidTagId = `band-${crypto.randomUUID().slice(0, 8)}`;
      setBandId(rfidTagId);
      const { session_id: sessionId } = await createSession(TENANT_ID, rfidTagId);
      await postConsent(sessionId, consent, saveProfile);

      await captureRef.current.start(videoRef.current!);
      // ~2s stand-still capture (Decision D2).
      await new Promise((r) => setTimeout(r, 2000));
      const result = await captureRef.current.capture();
      captureRef.current.stop();

      await postBodyModel(sessionId, result.measurements);
      await uploadPersonFrame(sessionId, result.frameBase64);

      setScreen('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setScreen('consent'); // show the error where the user can act on it
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <StepIndicator current={stepIndex} />

        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
          {/* ── Welcome ─────────────────────────────────────────── */}
          {screen === 'welcome' && (
            <div className="text-center">
              <div className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full text-sm font-medium text-purple-700 mb-6">
                <Sparkles className="w-4 h-4 mr-2" />
                AAYNA Style Station
              </div>
              <h1 className="text-4xl font-bold text-gray-900 mb-4">
                See clothes on{' '}
                <span className="aayna-gradient-text">your body</span>
              </h1>
              <p className="text-gray-600 mb-8 leading-relaxed">
                Our style station shows how outfits will look on you — without trying
                everything on physically.
              </p>

              <div className="grid gap-3 text-left mb-8">
                <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                  <Scan className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-gray-700">
                    <strong>What we scan:</strong> a short photo of your body to estimate
                    proportions (height, chest, waist, hips).
                  </p>
                </div>
                <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                  <ShieldCheck className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-gray-700">
                    <strong>What we never do:</strong> store your face or any facial data.
                  </p>
                </div>
                <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
                  <Clock className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-gray-700">
                    <strong>How long we keep it:</strong> deleted automatically at end of day
                    unless you ask us to save your profile.
                  </p>
                </div>
              </div>

              <button onClick={() => setScreen('consent')} className="aayna-btn w-full py-4 text-lg">
                Continue
              </button>
            </div>
          )}

          {/* ── Consent ─────────────────────────────────────────── */}
          {screen === 'consent' && (
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">Your choice</h1>

              <label className="flex items-start gap-4 bg-gray-50 rounded-xl p-4 mb-3 cursor-pointer hover:bg-purple-50 transition-colors">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-purple-600"
                />
                <span className="text-sm text-gray-700 leading-relaxed">
                  I agree to have my body proportions scanned and used for virtual try-on during
                  this visit. A photo taken during the scan is sent to our rendering partner and
                  not stored.{' '}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                    Required
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-4 bg-gray-50 rounded-xl p-4 mb-8 cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="checkbox"
                  checked={saveProfile}
                  onChange={(e) => setSaveProfile(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-blue-600"
                />
                <span className="text-sm text-gray-700 leading-relaxed">
                  Save my profile for my next visit{' '}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    Optional
                  </span>
                </span>
              </label>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button disabled={!consent || busy} onClick={startScan} className="aayna-btn w-full py-4 text-lg">
                {busy ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Scanning…
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5" /> Agree &amp; Scan
                  </>
                )}
              </button>
            </div>
          )}

          {/* ── Scan ────────────────────────────────────────────── */}
          {screen === 'scan' && (
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Stand still…</h1>
              <p className="text-gray-500 mb-6">Capturing your proportions — takes ~2 seconds</p>
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-purple-400 via-blue-500 to-purple-600 p-1">
                <video ref={videoRef} muted playsInline className="rounded-xl w-full" />
                <div className="absolute inset-x-16 top-4 bottom-4 border-2 border-dashed border-white/60 rounded-xl pointer-events-none" />
              </div>
              <div className="flex items-center justify-center gap-2 mt-6 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Processing…</span>
              </div>
            </div>
          )}

          {/* ── Done ────────────────────────────────────────────── */}
          {screen === 'done' && (
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center shadow-lg">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-3">You're all set!</h1>
              <p className="text-gray-600 mb-6">
                Take this band with you. Tap it at any display to see how outfits look on you.
              </p>

              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 rounded-2xl p-5 mb-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Your band ID</p>
                <div className="flex items-center justify-center gap-2">
                  <code className="text-xl font-bold aayna-gradient-text select-all">{bandId}</code>
                  <Copy
                    className="w-4 h-4 text-gray-400 cursor-pointer hover:text-purple-600"
                    onClick={() => navigator.clipboard?.writeText(bandId)}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  In production the physical RFID band carries this — for dev, type it into the display.
                </p>
              </div>

              <div className="flex items-start justify-center gap-2 text-gray-400">
                <Clock className="w-3.5 h-3.5 mt-0.5" />
                <p className="text-xs">Person frames expire after 10 minutes — try garments within that window.</p>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">AAYNA · Your mirror, everywhere you shop</p>
      </div>
    </div>
  );
}
