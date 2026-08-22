import { useEffect, useState } from 'react';
import type { AnalyticsSummary, Garment } from '@aayna/shared-types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? '';

function authHeaders(token: string) {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

type Tab = 'catalog' | 'analytics';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('catalog');

  if (!token) return <Login onLogin={setToken} />;

  return (
    <>
      <header>
        <h1>AAYNA Admin</h1>
        <nav>
          <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Catalog</button>
          <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}>Analytics</button>
        </nav>
      </header>
      <main>
        {tab === 'catalog' ? <Catalog token={token} /> : <Analytics token={token} />}
      </main>
    </>
  );
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const [email, setEmail] = useState('admin@pilot.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const res = await fetch(`${API}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { setError('Login failed'); return; }
    const { token } = await res.json();
    onLogin(token);
  }

  return (
    <main style={{ maxWidth: 380, marginTop: 80 }}>
      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Retailer login</h2>
        <div className="field"><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="primary" onClick={submit}>Log in</button>
        {error && <p style={{ color: '#c0392b', marginTop: 10 }}>{error}</p>}
      </div>
    </main>
  );
}

function Catalog({ token }: { token: string }) {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [bulk, setBulk] = useState('');

  async function load() {
    const res = await fetch(`${API}/v1/tenants/${TENANT_ID}/garments`, { headers: authHeaders(token) });
    const { garments: list } = await res.json();
    setGarments(list);
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function bulkImport() {
    try {
      const items = JSON.parse(bulk);
      const res = await fetch(`${API}/v1/tenants/${TENANT_ID}/garments/bulk-import`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBulk('');
      await load();
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function deactivate(id: string) {
    await fetch(`${API}/v1/tenants/${TENANT_ID}/garments/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    await load();
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Bulk import (JSON array)</h3>
        <textarea rows={4} placeholder='[{"sku":"TEE-01","name":"Classic Tee","reference_image_url":"https://…"}]' value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <button className="primary" style={{ marginTop: 10 }} onClick={bulkImport}>Import</button>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>SKU</th><th>Name</th><th>Category</th><th>Image QC</th><th></th></tr>
          </thead>
          <tbody>
            {garments.map((g) => (
              <tr key={g.id}>
                <td>{g.sku}</td>
                <td>{g.name}</td>
                <td>{g.category ?? '—'}</td>
                <td><span className={`badge ${g.image_qc_status}`}>{g.image_qc_status}</span></td>
                <td>{g.active && <button className="primary" onClick={() => deactivate(g.id)}>Deactivate</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Analytics({ token }: { token: string }) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    void fetch(`${API}/v1/tenants/${TENANT_ID}/analytics/summary`, { headers: authHeaders(token) })
      .then((r) => r.json())
      .then(setSummary);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!summary) return <p>Loading…</p>;

  return (
    <>
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card"><label>Sessions today</label><div className="stat">{summary.sessions_today}</div></div>
        <div className="card"><label>Renders today</label><div className="stat">{summary.renders_today}</div></div>
        <div className="card"><label>Consent opt-in rate</label><div className="stat">{Math.round(summary.consent_opt_in_rate * 100)}%</div></div>
      </div>
      <div className="card">
        <h3>Top viewed garments</h3>
        <table>
          <thead><tr><th>Garment</th><th>Views</th></tr></thead>
          <tbody>
            {summary.top_viewed_garments.map((g) => (
              <tr key={g.garment_id}><td>{g.name}</td><td>{g.views}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Render success rate per vendor</h3>
        <table>
          <thead><tr><th>Vendor</th><th>Success rate</th><th>Total renders</th></tr></thead>
          <tbody>
            {summary.render_success_rate_per_vendor.map((v) => (
              <tr key={v.vendor}><td>{v.vendor}</td><td>{Math.round(v.success_rate * 100)}%</td><td>{v.total}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
