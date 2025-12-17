"use client"
import React, { useState, useRef } from 'react'

type QueryResult = {
  video_id: string
  ad_url?: string
  adUrl?: string
  avg_similarity: number
  max_similarity: number
  matches_count: number
}

type ApiResponse = {
  results: QueryResult[]
}

function isQueryResult(obj: any): obj is QueryResult {
  return (
    obj &&
    typeof obj.video_id === 'string' &&
    ((typeof obj.ad_url === 'string' && obj.ad_url.length > 0) || (typeof obj.adUrl === 'string' && obj.adUrl.length > 0) || typeof obj.ad_url === 'undefined') &&
    typeof obj.avg_similarity === 'number' &&
    typeof obj.max_similarity === 'number' &&
    typeof obj.matches_count === 'number'
  )
}

function validateResponse(data: any): data is ApiResponse {
  if (!data || !Array.isArray(data.results)) return false
  return data.results.every(isQueryResult)
}

export default function VideoQuery(): React.ReactElement {
  const [pageId, setPageId] = useState('')
  const [topK, setTopK] = useState<number>(5)
  const [file, setFile] = useState<File | null>(null)
  // Vercel serverless function request body limit: ~4.5MB. Avoid uploading larger files to `/api/query`.
  const VERCEL_MAX_BODY = 4.5 * 1024 * 1024 // 4.5MB
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<QueryResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [copySuccess, setCopySuccess] = useState<string>('')

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

    // Prevent sending large files directly to Next.js/Vercel functions which have strict limits
    if (file.size > VERCEL_MAX_BODY) {
      return setError('File too large for direct server upload (over ~4.5 MB). Please use the "Upload to GCS & Query" page which uploads directly to Cloud Storage and then notifies the server.')
    }

    setLoading(true)
    setStatusMessage('Preparing upload...')
    setResults(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('top_k', String(topK))
      if (pageId) fd.append('page_id', pageId)

      setStatusMessage('Uploading file to server...')
      // Send to our Next.js server route which will forward to Cloud Run
      const res = await fetch('/api/query', {
        method: 'POST',
        body: fd,
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Server error: ${res.status}`)
      }

      setStatusMessage('Processing results...')
      const raw = await res.json()
      if (!validateResponse(raw)) {
        throw new Error('Invalid server response format')
      }
      const data = raw as ApiResponse
      setResults(data.results ?? [])
      setStatusMessage('Done')
    } catch (err: any) {
      console.error('Upload error', err)
      setError(err?.message || 'Upload or server error')
      setStatusMessage(`Failed: ${err?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
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
        <p className="text-sm text-gray-500 mt-1">Upload a video and enter a page ID to query. The uploaded file will be posted to <code>http://localhost:8000/query_video</code>.</p>

        <form className="mt-4" onSubmit={submit}>
              <label className="block text-sm font-medium">Page ID (optional)</label>
              <input type="text" value={pageId} onChange={e => setPageId(e.target.value)} className="mt-1 block w-full rounded-md border-gray-200 shadow-sm p-2 text-sm focus:ring-2 focus:ring-indigo-200" placeholder="Company page id (optional)" />

          <label className="block text-sm font-medium mt-3">Video File</label>
          <input ref={fileInputRef} type="file" accept="video/*" onChange={onFileChange} className="mt-1 block w-full text-sm text-gray-600" />

          <div className="mt-3 grid grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-sm font-medium">Top K</label>
              <input type="number" value={topK} onChange={e => setTopK(Math.max(1, Number(e.target.value || 1)))} min={1} step={1} className="mt-1 block w-full rounded-md border-gray-200 shadow-sm p-2 text-sm focus:ring-2 focus:ring-indigo-200" />
              <p className="text-xs text-gray-500 mt-1">How many results to return (top_k)</p>
            </div>
          </div>

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
                    <th className="p-2 font-medium">Video ID</th>
                    <th className="p-2 font-medium">Ad URL</th>
                    <th className="p-2 font-medium">Avg similarity</th>
                    <th className="p-2 font-medium">Max similarity</th>
                    <th className="p-2 font-medium">Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.video_id} className="hover:bg-gray-50">
                      <td className="p-2 align-top">{r.video_id}</td>
                      <td className="p-2 align-top">
                        {(r.ad_url || (r as any).adUrl) ? (
                          <div className="flex items-center gap-2">
                            <a className="text-indigo-600 break-all" href={r.ad_url ?? (r as any).adUrl} target="_blank" rel="noreferrer">{r.ad_url ?? (r as any).adUrl}</a>
                            <button className="px-2 py-1 text-xs border border-gray-200 rounded-md text-gray-700 hover:bg-gray-100" onClick={() => copyToClipboard(r.ad_url ?? (r as any).adUrl)}>Copy</button>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">—</span>
                        )}
                      </td>
                      <td className="p-2 align-top">{r.avg_similarity.toFixed(4)}</td>
                      <td className="p-2 align-top">{r.max_similarity.toFixed(6)}</td>
                      <td className="p-2 align-top">{r.matches_count}</td>
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
