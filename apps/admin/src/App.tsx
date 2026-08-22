import { useEffect, useState } from 'react';
import {
  Sparkles,
  LogOut,
  Upload,
  Users,
  Eye,
  ShieldCheck,
  Loader2,
  AlertCircle,
  TrendingUp,
  Shirt,
  LayoutGrid,
  BarChart3,
} from 'lucide-react';
import type { AnalyticsSummary, Garment } from '@aayna/shared-types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';

function authHeaders(token: string) {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

type Tab = 'catalog' | 'analytics';

const SESSION_KEY = 'aayna_admin_session';

interface AdminSession { token: string; tenantId: string }

function loadSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(loadSession);
  const [tab, setTab] = useState<Tab>('catalog');

  if (!session) return <Login onLogin={setSession} />;

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
              AAYNA <span className="aayna-gradient-text">Admin</span>
            </h1>
          </div>
          <nav className="flex items-center gap-2">
            <button
              onClick={() => setTab('catalog')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === 'catalog'
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <LayoutGrid className="w-4 h-4" /> Catalog
            </button>
            <button
              onClick={() => setTab('analytics')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === 'analytics'
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Analytics
            </button>
            <button
              onClick={() => { sessionStorage.removeItem(SESSION_KEY); setSession(null); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'catalog'
          ? <Catalog token={session.token} tenantId={session.tenantId} />
          : <Analytics token={session.token} tenantId={session.tenantId} />}
      </main>
    </div>
  );
}

/* ── Login ──────────────────────────────────────────────────── */

function Login({ onLogin }: { onLogin: (s: AdminSession) => void }) {
  const [email, setEmail] = useState('admin@pilot.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { setError('Login failed — check email/password'); return; }
      const { token, tenant_id: tenantId } = await res.json();
      const s: AdminSession = { token, tenantId: tenantId ?? TENANT_ID };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      onLogin(s);
    } catch {
      setError('Cannot reach API at ' + API + ' — is it running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 shadow-lg mb-4">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              AAYNA <span className="aayna-gradient-text">Admin</span>
            </h1>
            <p className="text-sm text-gray-500 mt-1">Retailer dashboard</p>
          </div>

          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:outline-none mb-4 transition-colors"
          />

          <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:outline-none mb-6 transition-colors"
          />

          <button onClick={submit} disabled={busy} className="aayna-btn w-full py-3.5">
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" /> Logging in…
              </>
            ) : (
              'Log in'
            )}
          </button>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mt-6">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-gray-400 mt-6">AAYNA · Your mirror, everywhere you shop</p>
      </div>
    </div>
  );
}

/* ── Catalog ────────────────────────────────────────────────── */

const QC_STYLES: Record<string, string> = {
  passed: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  flagged: 'bg-red-100 text-red-700',
};

function Catalog({ token, tenantId }: { token: string; tenantId: string }) {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bulk, setBulk] = useState('');
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API}/v1/tenants/${tenantId}/garments`, { headers: authHeaders(token) });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const { garments: list } = await res.json();
      setGarments(list ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load catalog');
    }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function bulkImport() {
    setImporting(true);
    try {
      const items = JSON.parse(bulk);
      const res = await fetch(`${API}/v1/tenants/${tenantId}/garments/bulk-import`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBulk('');
      await load();
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setImporting(false);
    }
  }

  async function deactivate(id: string) {
    await fetch(`${API}/v1/tenants/${tenantId}/garments/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      {/* Bulk import */}
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500">
            <Upload className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Bulk import</h3>
            <p className="text-xs text-gray-500">Paste a JSON array of garments</p>
          </div>
        </div>
        <textarea
          rows={4}
          placeholder='[{"sku":"TEE-01","name":"Classic Tee","reference_image_url":"https://…"}]'
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:outline-none font-mono text-sm transition-colors"
        />
        <button onClick={bulkImport} disabled={!bulk.trim() || importing} className="aayna-btn mt-4 px-6 py-2.5 text-sm">
          {importing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Importing…
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" /> Import
            </>
          )}
        </button>
      </div>

      {/* Catalog table */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500">
            <Shirt className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-bold text-gray-900">Garment catalog</h3>
          <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
            {garments.length} items
          </span>
        </div>

        {loadError && (
          <div className="flex items-start gap-2 bg-red-50 border-b border-red-200 p-4">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">Catalog load failed: {loadError}</p>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-6 py-3">SKU</th>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Image QC</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {garments.map((g) => (
              <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                <td className="px-6 py-3.5 font-mono text-xs text-gray-500">{g.sku}</td>
                <td className="px-6 py-3.5 font-medium text-gray-900">{g.name}</td>
                <td className="px-6 py-3.5 text-gray-600">{g.category ?? '—'}</td>
                <td className="px-6 py-3.5">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${QC_STYLES[g.image_qc_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {g.image_qc_status}
                  </span>
                </td>
                <td className="px-6 py-3.5 text-right">
                  {g.active && (
                    <button
                      onClick={() => void deactivate(g.id)}
                      className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {garments.length === 0 && !loadError && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                  No garments yet — import some above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Analytics ──────────────────────────────────────────────── */

function Analytics({ token, tenantId }: { token: string; tenantId: string }) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    void fetch(`${API}/v1/tenants/${tenantId}/analytics/summary`, { headers: authHeaders(token) })
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading analytics…
      </div>
    );
  }

  const stats = [
    {
      title: 'Sessions Today',
      value: String(summary.sessions_today),
      icon: Users,
      color: 'from-blue-500 to-blue-600',
    },
    {
      title: 'Renders Today',
      value: String(summary.renders_today),
      icon: Eye,
      color: 'from-purple-500 to-purple-600',
    },
    {
      title: 'Consent Opt-In Rate',
      value: `${Math.round(summary.consent_opt_in_rate * 100)}%`,
      icon: ShieldCheck,
      color: 'from-green-500 to-green-600',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.title} className="bg-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-xl bg-gradient-to-r ${stat.color}`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
            <div className="text-sm text-gray-500">{stat.title}</div>
          </div>
        ))}
      </div>

      {/* Top viewed */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-bold text-gray-900">Top viewed garments</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-6 py-3">Garment</th>
              <th className="px-6 py-3">Views</th>
            </tr>
          </thead>
          <tbody>
            {summary.top_viewed_garments.map((g) => (
              <tr key={g.garment_id} className="border-b border-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{g.name}</td>
                <td className="px-6 py-3 text-gray-600">{g.views}</td>
              </tr>
            ))}
            {summary.top_viewed_garments.length === 0 && (
              <tr><td colSpan={2} className="px-6 py-8 text-center text-gray-400">No views recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Vendor success */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-bold text-gray-900">Render success rate per vendor</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-6 py-3">Vendor</th>
              <th className="px-6 py-3">Success rate</th>
              <th className="px-6 py-3">Total renders</th>
            </tr>
          </thead>
          <tbody>
            {summary.render_success_rate_per_vendor.map((v) => (
              <tr key={v.vendor} className="border-b border-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{v.vendor}</td>
                <td className="px-6 py-3 text-gray-600">{Math.round(v.success_rate * 100)}%</td>
                <td className="px-6 py-3 text-gray-600">{v.total}</td>
              </tr>
            ))}
            {summary.render_success_rate_per_vendor.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">No renders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
