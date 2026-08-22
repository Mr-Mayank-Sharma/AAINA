import { useCallback, useEffect, useState } from 'react';
import {
  ScanLine,
  Shirt,
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Ruler,
  CheckCircle2,
} from 'lucide-react';
import type { Garment } from '@aayna/shared-types';
import { getSessionByRfid, listGarments, pollRender, requestRender } from './api';

const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';

type RenderState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; url: string }
  | { phase: 'failed'; message: string };

function GarmentCard({ garment, sessionId }: { garment: Garment; sessionId: string }) {
  const [sizeIndex, setSizeIndex] = useState(0);
  const [render, setRender] = useState<RenderState>({ phase: 'idle' });

  const doRender = useCallback(async () => {
    setRender({ phase: 'loading' });
    try {
      const size = garment.size_options?.[sizeIndex];
      const { render_request_id: requestId } = await requestRender(sessionId, garment.id, size);
      const result = await pollRender(requestId);
      if (result.status === 'complete' && result.output_image_url) {
        setRender({ phase: 'done', url: result.output_image_url });
      } else {
        setRender({ phase: 'failed', message: 'Render failed — try again' });
      }
    } catch (e) {
      setRender({ phase: 'failed', message: e instanceof Error ? e.message : 'Render failed' });
    }
  }, [garment.id, garment.size_options, sessionId, sizeIndex]);

  // Auto-render on mount and on size change.
  useEffect(() => {
    void doRender();
  }, [doRender]);

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
      {/* Render viewport */}
      <div className="relative aspect-[3/4] bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        {render.phase === 'loading' && (
          <>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-100/40 via-white/60 to-blue-100/40 animate-pulse" />
            <div className="relative flex flex-col items-center gap-2 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              <span className="text-sm">Rendering on you…</span>
            </div>
          </>
        )}
        {render.phase === 'done' && (
          <img className="w-full h-full object-contain" src={render.url} alt={garment.name} />
        )}
        {render.phase === 'failed' && (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <span className="text-sm text-red-600">{render.message}</span>
            <button
              onClick={() => void doRender()}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 hover:text-purple-700"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}
        {render.phase === 'idle' && (
          <Shirt className="w-12 h-12 text-gray-300" />
        )}
      </div>

      {/* Info bar */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-gray-900">{garment.name}</strong>
          {render.phase === 'done' && (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          )}
        </div>
        {garment.size_options?.length > 0 && (
          <button
            onClick={() => setSizeIndex((i) => (i + 1) % garment.size_options.length)}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold hover:from-purple-700 hover:to-blue-700 transition-all shadow"
          >
            <Ruler className="w-4 h-4" />
            Size: {garment.size_options[sizeIndex]}
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [rfid, setRfid] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bandLabel, setBandLabel] = useState('');
  const [garments, setGarments] = useState<Garment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function scanBand() {
    setError(null);
    setBusy(true);
    try {
      const session = await getSessionByRfid(rfid.trim());
      if (!session.has_body_model) {
        setError('Please finish your entry scan first.');
        return;
      }
      setSessionId(session.session_id);
      setBandLabel(rfid.trim());
      const { garments: list } = await listGarments(TENANT_ID);
      setGarments(list.filter((g) => g.image_qc_status === 'passed'));
    } catch {
      setError('No active session for this band. Scan at the entry kiosk first.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              AAYNA <span className="aayna-gradient-text">Virtual Try-On</span>
            </h1>
          </div>
          {sessionId && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-full text-sm font-medium text-purple-700">
              <ScanLine className="w-4 h-4" />
              {bandLabel}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {!sessionId ? (
          /* ── Band tap screen ─────────────────────────────── */
          <div className="max-w-md mx-auto pt-16">
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 flex items-center justify-center">
                <ScanLine className="w-8 h-8 text-purple-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Tap your band</h2>
              <p className="text-gray-500 mb-8 text-sm">
                Enter the band ID from the entry kiosk to see outfits on your body.
              </p>

              <input
                placeholder="band-xxxxxxxx"
                value={rfid}
                onChange={(e) => setRfid(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void scanBand()}
                className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:outline-none text-center font-mono mb-4 transition-colors"
              />
              <button onClick={scanBand} disabled={busy || !rfid.trim()} className="aayna-btn w-full py-3.5">
                {busy ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Looking up…
                  </>
                ) : (
                  <>
                    <ScanLine className="w-5 h-5" /> Scan Band
                  </>
                )}
              </button>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mt-6 text-left">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Garment rack ────────────────────────────────── */
          <>
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-gray-900">
                How they'd look <span className="aayna-gradient-text">on you</span>
              </h2>
              <p className="text-gray-500 mt-1">Tap a size to re-render instantly.</p>
            </div>
            {garments.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg p-12 text-center max-w-md mx-auto">
                <Shirt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">
                  No garments passed image QC yet — import some in the Admin catalog.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {garments.map((g) => (
                  <GarmentCard key={g.id} garment={g} sessionId={sessionId} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
