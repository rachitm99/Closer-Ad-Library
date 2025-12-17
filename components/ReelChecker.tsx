"use client"
import React, { useState } from 'react'
import { extractShortcodeFromUrl } from '../utils/extractShortcode'

type StepKey = 'extract' | 'rocket' | 'detect' | 'adDetails'
type StepStatus = 'idle' | 'in-progress' | 'success' | 'failed'
type Step = { key: StepKey; label: string; status: StepStatus; message?: string }

type ApiResult = {
  shortcode?: string
  isAd?: boolean
  adId?: string
  adUrl?: string
  adInfo?: any
  raw?: any
  message?: string
}

export default function ReelChecker(): React.ReactElement {
  const [url, setUrl] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [steps, setSteps] = useState<Step[]>([
    { key: 'extract', label: 'Extract Shortcode', status: 'idle' },
    { key: 'rocket', label: 'Call RocketAPI', status: 'idle' },
    { key: 'detect', label: 'Detect Ad', status: 'idle' },
    { key: 'adDetails', label: 'Fetch Ad Details', status: 'idle' },
  ])
  const [result, setResult] = useState<ApiResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState<string>('')

  const stripHtml = (html?: string) => {
    if (!html) return ''
    try {
      const el = typeof document !== 'undefined' ? document.createElement('div') : null
      if (!el) return html
      el.innerHTML = html
      return el.textContent || el.innerText || ''
    } catch (_) {
      return html
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    const maybeShortcode = extractShortcodeFromUrl(url)
    setSteps(prev => prev.map(s => ({ ...s, status: 'idle', message: '' })))
    updateStep('extract', 'in-progress')

    try {
      const payload = { url, useMock: false }
      updateStep('extract', 'success', `Shortcode: ${maybeShortcode || 'unknown'}`)
      updateStep('rocket', 'in-progress')
      const res = await fetch('/api/check-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as ApiResult
      if (!res.ok) {
        updateStep('rocket', 'failed', data?.message || `HTTP ${res.status}`)
        throw new Error((data as any)?.message || 'API Error')
      }
      updateStep('rocket', 'success')
      if (data?.isAd) {
        updateStep('detect', 'success', `Ad ID: ${data.adId}`)
      } else {
        updateStep('detect', 'failed', 'Not an ad')
      }
      setResult(data)
      updateStep('adDetails', 'in-progress')
      if (data?.adUrl || data?.adInfo) {
        updateStep('adDetails', 'success', `adUrl: ${data.adUrl ?? (data.adInfo?.snapshot?.link_url || '')}`)
      } else {
        updateStep('adDetails', 'failed', 'No ad details')
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Client error', err)
      setError(err?.message || 'Error')
    } finally {
      setLoading(false)
    }
  }

  function updateStep(key: StepKey, status: StepStatus, message = '') {
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, status, message } : s)))
  }

  const copyToClipboard = async (text: unknown) => {
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
    <div className="max-w-3xl mx-auto mt-7 px-4">
      <div className="bg-white rounded-xl shadow-card p-4 transition-transform hover:-translate-y-1">
        <header className="flex flex-col gap-1 mb-2">
          <h1 className="text-xl font-semibold">Instagram Reel Ad Checker</h1>
          <div className="text-sm text-gray-500">Enter a reel URL and the system will check for ad metadata.</div>
        </header>

        <div className="flex flex-col  gap-3 mb-3" aria-hidden={false}>
          {steps.map(s => (
            <div key={s.key} role="status" aria-live="polite" className={`flex gap-3 items-start p-3 rounded-lg w-full ${s.status === 'in-progress' ? 'bg-gradient-to-r from-indigo-50 to-white shadow-inner' : s.status === 'success' ? 'bg-green-50 border border-green-100' : s.status === 'failed' ? 'bg-red-50 border border-red-100' : 'bg-gray-50'}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white shadow-sm">
                {s.status === 'in-progress' ? <div className="w-4 h-4 rounded-full border-2 border-gray-200 border-t-indigo-600 animate-spin" /> : s.status === 'success' ? '✔' : s.status === 'failed' ? '✖' : '•'}
              </div>
              <div className="flex flex-col">
                <div className="text-sm font-semibold">{s.label}</div>
                {s.message && <div className="text-sm text-gray-500 mt-1">{s.message}</div>}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mb-3">
          <label htmlFor="url" className="block text-sm font-medium">Instagram Reel URL</label>
          <div className="flex flex-col md:flex-row gap-3 mt-2">
            <input id="url" className="flex-1 rounded-lg px-3 py-2 border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/<shortcode>/" required />
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-3 py-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading && <div className="w-4 h-4 rounded-full border-2 border-gray-200 border-t-white animate-spin" />}
              {loading ? 'Checking…' : 'Check'}
            </button>
          </div>
        </form>

        {error && <div className="text-red-600 mt-3">Error: {error}</div>}

        {result && (
          <div className="bg-gradient-to-b from-white to-slate-50 p-3 rounded-lg border border-slate-100 mt-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="text-sm"><strong>Shortcode:</strong> {result.shortcode}</div>
              <div className="inline-block bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full font-semibold text-sm">{result.isAd ? 'Ad' : 'Organic'}</div>
            </div>

            {result.isAd && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <div className="bg-gray-50 border border-slate-100 p-2 rounded-md"><strong>Ad ID:</strong> {result.adId}</div>
                <button className="border border-gray-200 rounded-md px-2 py-1 text-sm hover:bg-gray-100" onClick={() => copyToClipboard(result.adId)} aria-label="Copy Ad ID">Copy</button>
                {copySuccess && <div className="text-green-600 text-sm">{copySuccess}</div>}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <strong>Is Ad:</strong> {result.isAd ? 'Yes' : 'No'}
            </div>

            {result.adUrl && (
              <div className="mt-3">
                <strong>Ad URL:</strong>
                <div className="mt-2">
                  <a href={result.adUrl} target="_blank" rel="noreferrer" className="text-indigo-600 break-all">{result.adUrl}</a>
                  <button className="border border-gray-200 rounded-md px-2 py-1 text-sm hover:bg-gray-100 ml-2" onClick={() => copyToClipboard(result.adUrl)} aria-label="Copy Ad URL">Copy</button>
                </div>
              </div>
            )}

            {result.adInfo?.snapshot && (
              <div className="bg-white p-3 rounded-md flex flex-col gap-2 mt-3">
                <div><strong>Page:</strong> {result.adInfo.snapshot.page_name}</div>
                <div><strong>Title:</strong> {result.adInfo.snapshot.title}</div>
                <div><strong>Caption:</strong> <span>{stripHtml(result.adInfo.snapshot.body)}</span></div>
              </div>
            )}

            {result.adInfo && (
              <details className="mt-3">
                <summary>Raw ad info</summary>
                <pre className="whitespace-pre-wrap max-h-96 overflow-auto">{JSON.stringify(result.adInfo, null, 2)}</pre>
              </details>
            )}

            <hr className="mt-3" />
            <details>
              <summary>Raw API response (truncated)</summary>
              <pre className="whitespace-pre-wrap max-h-96 overflow-auto">{JSON.stringify(result.raw, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
