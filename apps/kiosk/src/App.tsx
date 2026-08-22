import { useRef, useState } from 'react';
import { WebcamCapture } from './capture';
import { createSession, postConsent, postBodyModel, uploadPersonFrame } from './api';

type Screen = 'welcome' | 'consent' | 'scan' | 'done';

const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [consent, setConsent] = useState(false);
  const [saveProfile, setSaveProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<WebcamCapture>(new WebcamCapture());

  async function startScan() {
    setBusy(true);
    setError(null);
    try {
      // Mount the video element first.
      setScreen('scan');
      await new Promise((r) => setTimeout(r, 50));

      // Screen 3 order per spec: session → consent → body-model → frame upload.
      const rfidTagId = `band-${crypto.randomUUID().slice(0, 8)}`;
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {screen === 'welcome' && (
        <>
          <h1>Welcome to AAYNA</h1>
          <p>
            Our style station can show you how clothes will look on your body — without
            trying everything on physically.
          </p>
          <p>
            <strong>What we scan:</strong> a short photo of your body to estimate proportions
            (height, chest, waist, hips). <strong>What we never do:</strong> store your face
            or any facial data.
          </p>
          <p>
            <strong>How long we keep it:</strong> deleted automatically at end of day unless
            you ask us to save your profile.
          </p>
          <button onClick={() => setScreen('consent')}>Continue</button>
        </>
      )}

      {screen === 'consent' && (
        <>
          <h1>Your choice</h1>
          <label className="row">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I agree to have my body proportions scanned and used for virtual try-on during
              this visit. A photo taken during the scan is sent to our rendering partner and
              not stored. (Required)
            </span>
          </label>
          <label className="row">
            <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
            <span>Save my profile for my next visit (optional)</span>
          </label>
          <button disabled={!consent || busy} onClick={startScan}>
            {busy ? 'Scanning…' : 'Agree & Scan'}
          </button>
          {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
        </>
      )}

      {screen === 'scan' && (
        <>
          <h1>Stand still…</h1>
          <video ref={videoRef} muted playsInline />
        </>
      )}

      {screen === 'done' && (
        <>
          <div className="ok">✓</div>
          <h1>You're all set!</h1>
          <p>Take this band with you. Tap it at any display to see how outfits look on you.</p>
        </>
      )}
    </div>
  );
}
