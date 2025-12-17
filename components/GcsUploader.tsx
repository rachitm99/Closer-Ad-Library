"use client"
import React, { useState, useRef } from 'react'
import { normalizeCloudRunResults, NormalizedResult } from '../lib/normalizeCloudRun'

const MAX_FILE_BYTES = 500 * 1024 * 1024 // 500MB

export default function GcsUploader(): React.ReactElement {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [result, setResult] = useState<any | null>(null)
  const [results, setResults] = useState<NormalizedResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gcsPath, setGcsPath] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [notifyAttempts, setNotifyAttempts] = useState(0)
  const pageIdRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setProgress(0)
    setResult(null)
    setError(null)
  }

  const upload = async () => {
    if (!file) return setError('No file selected')
    if (file.size > MAX_FILE_BYTES) return setError('File exceeds max size')
    setError(null)
    setResult(null)
    setProgress(0)
    setIsUploading(true)
    setStatus('Requesting upload URL...')
    try {
      const res = await fetch('/api/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type || 'video/mp4' }) })
      if (!res.ok) throw new Error(`Upload URL request failed: ${res.status}`)
      const { uploadUrl, gcsPath } = await res.json()
      setGcsPath(gcsPath)
      setStatus('Uploading file...')
      // PUT with XHR to support progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed: ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(file)
      })
      setStatus('Notifying server...')
      const pageId = pageIdRef.current?.value
      // delegate to helper so we can retry on the client and show attempt count
      await notifyServer(gcsPath, pageId)
      setStatus('Done')
    } catch (err: any) {
      setError(err.message || String(err))
      setStatus(null)
    }
    setIsUploading(false)
    xhrRef.current = null
  }

const notifyServer = async (gcs: string, pageId?: string) => {
    setNotifyAttempts(0)
    const maxAttempts = 3
    let attempt = 0
    let lastErr: any = null
    while (attempt < maxAttempts) {
      attempt += 1
      setNotifyAttempts(attempt)
      try {
        const notifyRes = await fetch('/api/query-gcs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gcsPath: gcs, pageId }) })
        if (!notifyRes.ok) {
          const txt = await notifyRes.text()
          throw new Error(`Server query failed: ${notifyRes.status} ${txt}`)
        }
          const json = await notifyRes.json()
          setResult(json)
          const normalized = normalizeCloudRunResults(json)
          setResults(normalized)
          // show deleted_source warning if present
          if (json && json.deleted_source === false) {
            setError('Warning: source video marked as deleted/removed by provider.')
          } else {
            setError(null)
          }
        return
      } catch (err: any) {
        lastErr = err
        // exponential backoff
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)))
      }
    }
    throw lastErr
  }

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort()
      setIsUploading(false)
      setStatus(null)
      setError('Upload cancelled')
      xhrRef.current = null
    }
  }

  const retryNotify = async () => {
    if (!gcsPath) return setError('No uploaded file to notify')
    setError(null)
    setStatus('Retrying server notify...')
    setIsUploading(true)
    try {
      await notifyServer(gcsPath, pageIdRef.current?.value)
      setStatus('Done')
    } catch (err: any) {
      setError(err.message || String(err))
      setStatus(null)
    }
    setIsUploading(false)
  }

  const copyToClipboard = async (text: unknown) => {
    try {
      await navigator.clipboard.writeText(String(text))
      const prev = status
      setStatus('Copied to clipboard')
      setTimeout(() => setStatus(prev), 1500)
    } catch (err) {
      setError('Failed to copy to clipboard')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 mt-8">
      <div className="bg-white rounded-xl shadow-card p-4">
        <h2 className="text-lg font-semibold">Upload to GCS & Query</h2>
        <div className="mt-3">
          <label className="block text-sm font-medium">Page ID (optional)</label>
          <input ref={pageIdRef} className="mt-1 block w-full rounded-md border-gray-200 p-2" placeholder="company page id" />
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium">Video File</label>
          <input type="file" accept="video/*" onChange={onFile} className="mt-1 block w-full" />
        </div>
        {file && <div className="mt-2 text-sm text-gray-700">Selected: {file.name} — {(file.size / (1024*1024)).toFixed(2)} MB</div>}
        <div className="mt-4 flex gap-3">
          <button onClick={upload} disabled={!file || isUploading} className="bg-indigo-600 text-white px-3 py-2 rounded disabled:opacity-50">Upload & Query</button>
          <button onClick={() => { setFile(null); setProgress(0); setStatus(null); setResult(null); setResults(null); setError(null); setGcsPath(null); setNotifyAttempts(0) }} className="border px-3 py-2 rounded" disabled={isUploading}>Reset</button>
          {isUploading && <button onClick={cancelUpload} className="bg-red-500 text-white px-3 py-2 rounded">Cancel</button>}
          {!isUploading && gcsPath && error && <button onClick={retryNotify} className="bg-yellow-500 text-black px-3 py-2 rounded">Retry Notify</button>}
        </div>
        {status && <div className="mt-3 text-sm text-gray-600">{status}</div>}
        {progress > 0 && <div className="mt-2"><div className="w-full bg-gray-100 h-2 rounded"><div className="bg-indigo-600 h-2 rounded" style={{ width: `${progress}%` }} /></div><div className="text-xs mt-1">{progress}%</div></div>}
        {notifyAttempts > 0 && <div className="mt-2 text-xs text-gray-600">Notify attempts: {notifyAttempts}</div>}
        {error && <div className="mt-3 text-sm text-red-600">{error.startsWith('Warning:') ? <span className="inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2 rounded">⚠️ <span>{error.replace(/^Warning: /, '')}</span></span> : <span>Error: {error}</span>}</div>}
        {results && <div className="mt-3">
          <div className="mb-2">
            <strong>Results</strong>
          </div>
          <div className="mb-3 overflow-auto">
            {results.length > 0 ? (
              <table className="min-w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 font-medium">Ad ID</th>
                    <th className="p-2 font-medium">Ad URL</th>
                    <th className="p-2 font-medium">Total Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="p-2 align-top">{r.id}</td>
                      <td className="p-2 align-top">
                        {r.url ? (
                          <div className="flex items-center gap-2">
                            <a className="text-indigo-600 break-all" href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
                            <button className="px-2 py-1 text-xs border border-gray-200 rounded-md text-gray-700 hover:bg-gray-100" onClick={() => copyToClipboard(r.url)}>Copy</button>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">—</span>
                        )}
                      </td>
                      <td className="p-2 align-top">{typeof r.total_distance === 'number' ? r.total_distance : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="text-sm text-gray-600">No results returned.</div>}
          </div>
          <details className="mt-2"><summary className="cursor-pointer text-sm text-gray-700">View full response</summary><pre className="whitespace-pre-wrap max-h-80 overflow-auto mt-2">{JSON.stringify(result, null, 2)}</pre></details>
        </div>}
      </div>
    </div>
  )
}
