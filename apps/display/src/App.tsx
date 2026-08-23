/**
 * AAYNA Display — one application, two roles.
 *
 * SETUP (staff): on first boot, or anytime via "Change Display", the screen
 * walks through: where am I standing (label) → single garment or a rack list →
 * pick garments by ID with autocomplete. Saved to the API; the device remembers
 * its display ID locally.
 *
 * RUNTIME (customer): idle screen shows the display ID and waits for an RFID
 * band tap (USB readers emulate keyboards — their keystrokes land in the global
 * buffer). A tap resolves the shopper's session at the gate and renders every
 * garment this display fronts, on their body.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScanLine,
  Shirt,
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Ruler,
  CheckCircle2,
  Settings2,
  Search,
  X,
  Monitor,
  List,
  Square,
} from 'lucide-react';
import type { DisplayConfig, DisplayMode, Garment } from '@aayna/shared-types';
import {
  fetchRenderImageUrl,
  getDisplay,
  getSessionByRfid,
  listGarments,
  logGarmentView,
  pollRender,
  registerDisplay,
  requestRender,
  updateDisplay,
} from './api';

const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';
const STORAGE_KEY = 'aayna_display_id';

type Phase = 'boot' | 'setup' | 'idle' | 'active';

// ── Setup wizard ──────────────────────────────────────────────────────────

function SetupScreen({
  existing,
  onSaved,
}: {
  existing: DisplayConfig | null;
  onSaved: (d: DisplayConfig) => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? '');
  const [mode, setMode] = useState<DisplayMode>(existing?.mode ?? 'list');
  const [selected, setSelected] = useState<Garment[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Garment[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced autocomplete against the catalog.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { garments } = await listGarments(TENANT_ID, query.trim());
        const chosenIds = new Set(selected.map((g) => g.id));
        setResults(garments.filter((g) => !chosenIds.has(g.id)).slice(0, 8));
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Preload existing selection when re-configuring.
  useEffect(() => {
    if (!existing || existing.garment_ids.length === 0) return;
    void (async () => {
      try {
        const { garments } = await listGarments(TENANT_ID);
        const byId = new Map(garments.map((g) => [g.id, g]));
        setSelected(existing.garment_ids.map((id) => byId.get(id)).filter(Boolean) as Garment[]);
      } catch {
        /* stale ids — user can re-pick */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  function toggle(g: Garment) {
    setSelected((s) => (s.some((x) => x.id === g.id) ? s.filter((x) => x.id !== g.id) : [...s, g]));
    setShowResults(false);
    setQuery('');
  }

  async function save() {
    if (selected.length === 0) {
      setError('Pick at least one garment.');
      return;
    }
    if (mode === 'single') setSelected((s) => s.slice(0, 1));
    setSaving(true);
    setError(null);
    const ids = (mode === 'single' ? selected.slice(0, 1) : selected).map((g) => g.id);
    try {
      const saved = existing
        ? await updateDisplay(existing.id, { label, mode, garment_ids: ids })
        : await registerDisplay(TENANT_ID, label, mode, ids);
      localStorage.setItem(STORAGE_KEY, saved.id);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save display');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 w-full max-w-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg">
            <Monitor className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Set up this <span className="aayna-gradient-text">display</span>
          </h1>
        </div>
        <p className="text-gray-500 text-sm mb-8">
          Place the screen in front of a garment or a rack, then tell it what it's showing.
        </p>

        {/* Label */}
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Name (optional)</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='e.g. "Denim wall", "Front window"'
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:outline-none mb-6 transition-colors"
        />

        {/* Mode */}
        <label className="block text-sm font-medium text-gray-700 mb-2">What is it showing?</label>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => setMode('single')}
            className={`flex items-center gap-2.5 px-4 py-3.5 rounded-xl border-2 transition-colors ${
              mode === 'single'
                ? 'border-purple-500 bg-purple-50 text-purple-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-600'
            }`}
          >
            <Square className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">One garment</span>
          </button>
          <button
            onClick={() => setMode('list')}
            className={`flex items-center gap-2.5 px-4 py-3.5 rounded-xl border-2 transition-colors ${
              mode === 'list'
                ? 'border-purple-500 bg-purple-50 text-purple-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-600'
            }`}
          >
            <List className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">A rack / line of garments</span>
          </button>
        </div>

        {/* Autocomplete picker */}
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Garments <span className="text-gray-400">(search by name or SKU)</span>
        </label>
        <div className="relative mb-3">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Start typing…"
            className="w-full pl-10 pr-10 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:outline-none transition-colors"
          />
          {searching && (
            <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
          )}
          {showResults && results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
              {results.map((g) => (
                <button
                  key={g.id}
                  onClick={() => toggle(g)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-purple-50 text-left transition-colors"
                >
                  <img src={g.reference_image_url} alt="" className="w-9 h-9 rounded-lg object-cover bg-gray-100" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{g.name}</span>
                    <span className="block text-xs text-gray-400">{g.sku}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {selected.map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-purple-100 text-purple-700 text-sm"
              >
                {g.name}
                <button onClick={() => toggle(g)} className="p-1 rounded-full hover:bg-purple-200">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button onClick={() => void save()} disabled={saving} className="aayna-btn w-full py-3.5">
          {saving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" /> {existing ? 'Update display' : 'Activate display'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Try-on card ───────────────────────────────────────────────────────────

type RenderState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; url: string }
  | { phase: 'failed'; message: string };

function GarmentCard({
  garment,
  sessionId,
  onViewed,
}: {
  garment: Garment;
  sessionId: string;
  onViewed?: () => void;
}) {
  const [sizeIndex, setSizeIndex] = useState(0);
  const [render, setRender] = useState<RenderState>({ phase: 'loading' });

  const doRender = useCallback(async () => {
    setRender({ phase: 'loading' });
    try {
      const size = garment.size_options?.[sizeIndex];
      const { render_request_id: requestId } = await requestRender(sessionId, garment.id, size);
      const result = await pollRender(requestId);
      if (result.status === 'complete') {
        // Authenticated fetch → blob URL (render bucket is private).
        const url = await fetchRenderImageUrl(requestId);
        setRender({ phase: 'done', url });
        onViewed?.();
      } else {
        setRender({ phase: 'failed', message: 'Render failed' });
      }
    } catch (e) {
      setRender({ phase: 'failed', message: e instanceof Error ? e.message : 'Render failed' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garment.id, sessionId, sizeIndex]);

  useEffect(() => {
    void doRender();
  }, [doRender]);

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
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
      </div>
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-gray-900">{garment.name}</strong>
          {render.phase === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
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

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [display, setDisplay] = useState<DisplayConfig | null>(null);
  const [catalog, setCatalog] = useState<Garment[]>([]);
  const [activeBand, setActiveBand] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(kind: 'error' | 'info', msg: string) {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }

  // Boot: resume stored display identity, else run setup.
  useEffect(() => {
    void (async () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setPhase('setup');
        return;
      }
      try {
        const d = await getDisplay(stored);
        setDisplay(d);
        const { garments } = await listGarments(TENANT_ID);
        setCatalog(garments.filter((g) => g.image_qc_status === 'passed'));
        setPhase('idle');
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        setPhase('setup');
      }
    })();
  }, []);

  const handleBand = useCallback(
    async (raw: string) => {
      const band = raw.trim();
      if (!band || !display) return;
      try {
        const session = await getSessionByRfid(band);
        if (!session.has_body_model) {
          showToast('info', 'Finish your entrance scan first — walk through the gate.');
          return;
        }
        setSessionId(session.session_id);
        setActiveBand(band);
        setPhase('active');
      } catch {
        showToast('info', 'No live session for that band. Walk through the entrance gate first.');
      }
    },
    [display],
  );

  // Global RFID buffer — USB readers emulate keyboards (digits + Enter).
  useEffect(() => {
    if (phase === 'setup' || phase === 'boot') return;
    let buf = '';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (buf.length >= 3) void handleBand(buf);
        buf = '';
      } else if (/^[a-zA-Z0-9-]$/.test(e.key)) {
        buf += e.key;
      } else if (e.key === 'Backspace') {
        buf = buf.slice(0, -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, handleBand]);

  // Auto-reset to idle after quiet time on the active screen.
  useEffect(() => {
    if (phase !== 'active') return;
    const t = setTimeout(() => {
      setActiveBand(null);
      setSessionId(null);
      setPhase('idle');
    }, 90_000);
    return () => clearTimeout(t);
  }, [phase, sessionId]);

  function endSession() {
    setActiveBand(null);
    setSessionId(null);
    setPhase('idle');
  }

  if (phase === 'boot') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (phase === 'setup') {
    return <SetupScreen existing={display} onSaved={(d) => { setDisplay(d); setPhase('idle'); }} />;
  }

  const shownGarments =
    display == null
      ? []
      : display.mode === 'single'
        ? catalog.filter((g) => g.id === display.garment_ids[0])
        : display.garment_ids
            .map((id) => catalog.find((g) => g.id === id))
            .filter(Boolean) as Garment[];

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
            {display && (
              <span className="hidden sm:inline-flex items-center gap-1.5 ml-2 px-3 py-1 bg-gray-100 rounded-full text-xs font-mono text-gray-500">
                <Monitor className="w-3.5 h-3.5" />
                {display.label || `DISPLAY-${display.id.slice(0, 8)}`}
              </span>
            )}
          </div>
          {activeBand && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-full text-sm font-medium text-purple-700">
              <ScanLine className="w-4 h-4" />
              {activeBand}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {phase === 'idle' && (
          /* ── Idle: waiting for a band tap ─────────────── */
          <div className="relative pt-14 pb-20 text-center">
            <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 flex items-center justify-center">
              <ScanLine className="w-10 h-10 text-purple-600 animate-pulse" />
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">Tap your band here</h2>
            <p className="text-gray-500 max-w-md mx-auto">
              Hold your band near the sensor to see{' '}
              {display?.mode === 'single' ? 'this outfit' : 'these outfits'} on you — instantly.
            </p>

            {/* What's on this display */}
            {shownGarments.length > 0 && (
              <div className="mt-12 flex flex-wrap justify-center gap-4">
                {shownGarments.map((g) => (
                  <div key={g.id} className="w-28 opacity-80">
                    <img
                      src={g.reference_image_url}
                      alt={g.name}
                      className="w-28 h-36 object-cover rounded-xl shadow bg-gray-100"
                    />
                    <p className="mt-1.5 text-xs text-gray-500 truncate">{g.name}</p>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setPhase('setup')}
              className="absolute bottom-0 right-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" /> Change Display
            </button>
          </div>
        )}

        {phase === 'active' && sessionId && (
          /* ── Active: renders for the tapped band ──────── */
          <>
            <div className="mb-8 flex items-end justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900">
                  How they'd look <span className="aayna-gradient-text">on you</span>
                </h2>
                <p className="text-gray-500 mt-1">Tap a size to re-render instantly.</p>
              </div>
              <button
                onClick={endSession}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-medium text-gray-600 hover:border-gray-300 transition-colors"
              >
                Done
              </button>
            </div>
            {shownGarments.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg p-12 text-center max-w-md mx-auto">
                <Shirt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No garments configured on this display.</p>
              </div>
            ) : (
              <div
                className={
                  display?.mode === 'single'
                    ? 'max-w-md mx-auto'
                    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6'
                }
              >
                {shownGarments.map((g) => (
                  <GarmentCard
                    key={g.id}
                    garment={g}
                    sessionId={sessionId}
                    onViewed={() => void logGarmentView(TENANT_ID, sessionId, g.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 inset-x-0 flex justify-center z-30 pointer-events-none">
          <div
            className={`pointer-events-auto inline-flex items-start gap-2 rounded-xl px-4 py-3 shadow-lg border max-w-md ${
              toast.kind === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-700'
            }`}
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">{toast.msg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
