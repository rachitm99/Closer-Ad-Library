"use client"
import { useState } from 'react'
import { extractShortcodeFromUrl } from '../utils/extractShortcode'

export default function ReelChecker() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState([
    { key: 'extract', label: 'Extract Shortcode', status: 'idle' },
    { key: 'rocket', label: 'Call RocketAPI', status: 'idle' },
    { key: 'detect', label: 'Detect Ad', status: 'idle' },
    { key: 'adDetails', label: 'Fetch Ad Details', status: 'idle' },
  ])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copySuccess, setCopySuccess] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    const maybeShortcode = extractShortcodeFromUrl(url);
    setSteps(prev => prev.map(s => ({ ...s, status: 'idle', message: '' })));
    updateStep('extract', 'in-progress');

    try {
      const payload = { url, useMock: false };
      updateStep('extract', 'success', `Shortcode: ${maybeShortcode || 'unknown'}`);
      updateStep('rocket', 'in-progress');
      const res = await fetch('/api/check-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        updateStep('rocket', 'failed', data?.message || `HTTP ${res.status}`);
        throw new Error(data?.message || 'API Error');
      }
      updateStep('rocket', 'success');
      if (data?.isAd) {
        updateStep('detect', 'success', `Ad ID: ${data.adId}`);
      } else {
        updateStep('detect', 'failed', 'Not an ad');
      }
      setResult(data);
      updateStep('adDetails', 'in-progress');
      if (data?.adUrl || data?.adInfo) {
        updateStep('adDetails', 'success', `adUrl: ${data.adUrl ?? (data.adInfo?.snapshot?.link_url || '')}`);
      } else {
        updateStep('adDetails', 'failed', 'No ad details');
      }
    } catch (err) {
      console.error('Client error', err);
      setError(err.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  function updateStep(key, status, message = '') {
    setSteps(prev => prev.map(s => s.key === key ? { ...s, status, message } : s));
  }

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text))
      setCopySuccess('Copied!')
      setTimeout(() => setCopySuccess(''), 2000)
    } catch (err) {
      setCopySuccess('Failed')
      setTimeout(() => setCopySuccess(''), 2000)
    }
  }

  return (
    <div className="container">
      <div className="card">
        <header className="app-header">
          <h1 className="app-title">Instagram Reel Ad Checker</h1>
          <div className="app-sub">Enter a reel URL and the system will check for ad metadata.</div>
        </header>

        <div className="status-steps" aria-hidden={false}>
          {steps.map(s => (
            <div key={s.key} className={`status-step ${s.status}`} role="status" aria-live="polite">
              <div className="badge">
                {s.status === 'in-progress' ? <div className="spinner" /> : s.status === 'success' ? '✔' : s.status === 'failed' ? '✖' : '•'}
              </div>
              <div>
                <div className="label">{s.label}</div>
                {s.message && <div className="meta">{s.message}</div>}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
          <label htmlFor="url">Instagram Reel URL</label>
          <div className="form-row" style={{ marginTop: 8 }}>
            <input
              id="url"
              className="input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/<shortcode>/"
              required
            />
            <button type="submit" disabled={loading} className="submit-btn">
              {loading && <div className="spinner" style={{ width: 16, height: 16, borderTopColor: '#fff' }} />}
              {loading ? 'Checking…' : 'Check'}
            </button>
          </div>
        
        </form>

        {error && <div style={{ color: 'red', marginTop: 12 }}>Error: {error}</div>}

        {result && (
          <div className="result-card" style={{ marginTop: 12 }}>
            <div className="meta-row">
              <div style={{ fontSize: 14 }}><strong>Shortcode:</strong> {result.shortcode}</div>
              <div className="chip">{result.isAd ? 'Ad' : 'Organic'}</div>
            </div>

            {result.isAd && (
              <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="meta-item"><strong>Ad ID:</strong> {result.adId}</div>
                <button className="copy-btn" onClick={() => copyToClipboard(result.adId)} aria-label="Copy Ad ID">Copy</button>
                {copySuccess && <div className="copy-success">{copySuccess}</div>}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <strong>Is Ad:</strong> {result.isAd ? 'Yes' : 'No'}
            </div>

            {result.adUrl && (
              <div style={{ marginTop: 10 }}>
                <strong>Ad URL:</strong>
                <div style={{ marginTop: 6 }}>
                  <a href={result.adUrl} target="_blank" rel="noreferrer">{result.adUrl}</a>
                  <button className="copy-btn" onClick={() => copyToClipboard(result.adUrl)} aria-label="Copy Ad URL" style={{ marginLeft: 8 }}>Copy</button>
                </div>
              </div>
            )}

            {result.adInfo?.snapshot && (
              <div style={{ marginTop: 12 }} className="ad-info">
                <div><strong>Page:</strong> {result.adInfo.snapshot.page_name}</div>
                <div><strong>Title:</strong> {result.adInfo.snapshot.title}</div>
                <div><strong>Caption:</strong> <span dangerouslySetInnerHTML={{ __html: result.adInfo.snapshot.body || '' }} /></div>
              </div>
            )}

            {result.adInfo && (
              <details style={{ marginTop: 12 }}>
                <summary>Raw ad info</summary>
                <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>{JSON.stringify(result.adInfo, null, 2)}</pre>
              </details>
            )}

            <hr style={{ marginTop: 12 }} />
            <details>
              <summary>Raw API response (truncated)</summary>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>{JSON.stringify(result.raw, null, 2)}</pre>
            </details>
          </div>
        )}

        
      </div>
    </div>
  )
}
