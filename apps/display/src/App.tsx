import { useCallback, useEffect, useState } from 'react';
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
    <div className="garment-card">
      <strong>{garment.name}</strong>
      <div className="render-box">
        {render.phase === 'loading' && <div className="shimmer" />}
        {render.phase === 'done' && <img className="result" src={render.url} alt={garment.name} />}
        {render.phase === 'failed' && <span style={{ color: '#ff6b6b' }}>{render.message}</span>}
        {render.phase === 'idle' && <span style={{ color: '#666' }}>Tap to preview</span>}
      </div>
      {garment.size_options?.length > 0 && (
        <button
          className="secondary"
          onClick={() => setSizeIndex((i) => (i + 1) % garment.size_options.length)}
        >
          Size: {garment.size_options[sizeIndex]} (tap to change)
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [rfid, setRfid] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function scanBand() {
    setError(null);
    try {
      const session = await getSessionByRfid(rfid.trim());
      if (!session.has_body_model) {
        setError('Please finish your entry scan first.');
        return;
      }
      setSessionId(session.session_id);
      const { garments: list } = await listGarments(TENANT_ID);
      setGarments(list.filter((g) => g.image_qc_status === 'passed'));
    } catch {
      setError('No active session for this band. Scan at the entry kiosk first.');
    }
  }

  return (
    <>
      {!sessionId ? (
        <>
          <h1>AAYNA Virtual Try-On</h1>
          {/* Mock RFID reader: type/paste the band ID. Real reader swaps in later. */}
          <input
            className="band"
            placeholder="Tap your band…"
            value={rfid}
            onChange={(e) => setRfid(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && scanBand()}
          />
          <button onClick={scanBand} style={{ marginLeft: 8 }}>Scan</button>
          {error && <p className="prompt" style={{ color: '#ff6b6b' }}>{error}</p>}
        </>
      ) : (
        <>
          <h1>How they'd look on you</h1>
          <div className="rack">
            {garments.map((g) => (
              <GarmentCard key={g.id} garment={g} sessionId={sessionId} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
