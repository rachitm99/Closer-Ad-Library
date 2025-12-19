"use client"
import React, { useState, useRef } from 'react'

import { normalizeCloudRunResults, NormalizedResult } from '../lib/normalizeCloudRun'

export default function VideoQuery(): React.ReactElement {
  const [pageId, setPageId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // We'll upload files to GCS by default and notify the server (avoids Vercel payload limits)
  const [progress, setProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [gcsPath, setGcsPath] = useState<string | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<NormalizedResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [copySuccess, setCopySuccess] = useState<string>('')

  // Search-related state
  type SearchResult = {
    page_id: string
    name: string
    image_uri?: string
    ig_username?: string | null
    category?: string
  }
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [selectedBrand, setSelectedBrand] = useState<SearchResult | null>(null)

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setResults(null)
    setError(null)
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!file) return setError('Please pick a video file to upload')



    setLoading(true)
    setStatusMessage('Preparing upload to GCS...')
    setResults(null)
    try {
      // Request a signed upload URL from the server
      const upReq = await fetch('/api/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type || 'video/mp4' }) })
      if (!upReq.ok) throw new Error(`Upload URL request failed: ${upReq.status}`)
      const { uploadUrl, gcsPath } = await upReq.json()
      setGcsPath(gcsPath)

      setStatusMessage('Uploading file to GCS...')
      setIsUploading(true)
      // PUT to signed URL with XHR to track progress
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

      setStatusMessage('Notifying server...')
      // Notify our server to call Cloud Run with the GCS path
      const notifyRes = await fetch('/api/query-gcs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gcsPath, pageId }) })
      if (!notifyRes.ok) {
        const txt = await notifyRes.text()
        throw new Error(`Server query failed: ${notifyRes.status} ${txt}`)
      }
      const raw = await notifyRes.json()
      // Normalize different possible response shapes into a consistent UI-friendly array
      const normalized = normalizeCloudRunResults(raw)
      // Accept empty arrays; display whatever the server returned
      setResults(normalized)
      setStatusMessage('Done')
    } catch (err: any) {
      console.error('Upload error', err)
      setError(err?.message || 'Upload or server error')
      setStatusMessage(`Failed: ${err?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
      setIsUploading(false)
      xhrRef.current = null
      // clear status after a short delay to avoid UI getting stuck
      setTimeout(() => setStatusMessage(null), 3000)
    }
  }

  const clear = () => {
    setFile(null)
    setResults(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const doSearch = async () => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setSearchResults(null)
      return
    }
    setSearchLoading(true)
    setSearchResults(null)
    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(searchQuery)}`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const items = (json?.searchResults || json?.items || json?.results || []) as any[]
      setSearchResults(items.map(i => ({ page_id: String(i.page_id ?? i.id ?? ''), name: i.name ?? i.page_name ?? i.title ?? '', image_uri: i.image_uri ?? i.image_uri ?? '', ig_username: i.ig_username ?? i.instagram ?? null, category: i.category ?? '' })))
    } catch (e: any) {
      console.error('Search failed', e)
      setError(String(e?.message ?? e))
    } finally {
      setSearchLoading(false)
    }
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
    <div className="max-w-3xl mx-auto px-4 mt-8">
      <div className="bg-white rounded-xl shadow-card p-4">
        <h2 className="text-lg font-semibold">Video Similarity Query</h2>
        <p className="text-sm text-gray-500 mt-1">Upload a video and optionally search for a brand to include its page ID in the query. The uploaded file will be posted to <code>http://localhost:8000/query_video</code>.</p>

        <form className="mt-4" onSubmit={submit}>
              <label className="block text-sm font-medium">Search brand (optional)</label>
              <div className="mt-1 flex gap-2">
                <input type="text" value={String((searchQuery ?? ''))} onChange={e => setSearchQuery(e.target.value)} className="flex-1 rounded-md border-gray-200 shadow-sm p-2 text-sm focus:ring-2 focus:ring-indigo-200" placeholder="Search for brand, e.g. " />
                <button type="button" onClick={() => doSearch()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-md text-sm">Search</button>
              </div>
              {searchLoading && <div className="text-xs text-gray-500 mt-1">Searching…</div>}
              {searchResults && searchResults.length > 0 && (
                <div className="mt-2 bg-white border rounded shadow-sm max-h-64 overflow-auto">
                  {searchResults.map(r => (
                    <div key={r.page_id} className={`p-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 ${pageId === r.page_id ? 'bg-indigo-50' : ''}`} onClick={() => { setPageId(r.page_id); setSelectedBrand(r); }}>
                      <img src={r.image_uri} alt={r.name} className="w-10 h-10 rounded object-cover" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="text-xs text-gray-500">{r.ig_username ? `@${r.ig_username}` : ''}</div>
                      </div>
                      <div className="text-xs text-gray-500">{r.category}</div>
                    </div>
                  ))}
                </div>
              )}
              {selectedBrand && (
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <img src={selectedBrand.image_uri} className="w-8 h-8 rounded object-cover" />
                  <div>
                    <div className="font-medium">{selectedBrand.name}</div>
                    <div className="text-xs text-gray-500">{selectedBrand.ig_username ? `@${selectedBrand.ig_username}` : ''}</div>
                  </div>
                  <button type="button" onClick={() => { setSelectedBrand(null); setPageId('') }} className="text-sm text-red-500 ml-auto">Remove</button>
                </div>
              )}

          <label className="block text-sm font-medium mt-3">Video File</label>
          <input ref={fileInputRef} type="file" accept="video/*" onChange={onFileChange} className="mt-1 block w-full text-sm text-gray-600" />



          {file && (
            <div className="mt-3 flex items-center gap-3">
              <div className="text-sm text-gray-700">Selected: <strong>{file.name}</strong></div>
              <button type="button" onClick={clear} className="text-sm text-red-500 hover:underline">Clear</button>
            </div>
          )}

          {error && (
            <div className="mt-3 text-sm text-red-600">Error: {error}</div>
          )}


          <div className="mt-4 flex items-center gap-3">
            <button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-3 py-2 rounded-md font-semibold text-sm">
              {loading ? 'Uploading…' : 'Upload & Query'}
            </button>
            <button type="button" onClick={() => { setResults(null); setError(null) }} className="border border-gray-200 px-3 py-2 rounded-md text-sm">Reset results</button>
          </div>
          {statusMessage && (
            <div className="mt-3 text-sm text-gray-600" role="status" aria-live="polite">{statusMessage}</div>
          )}
        </form>

        {results && results.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-medium">Results</h3>
            {copySuccess && <div className="text-green-600 text-sm mt-1">{copySuccess}</div>}
            <div className="mt-2 overflow-auto">
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
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
