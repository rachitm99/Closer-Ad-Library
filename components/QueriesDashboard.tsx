"use client"
import React, { useEffect, useState } from 'react'
import { normalizeCloudRunResults, NormalizedResult } from '../lib/normalizeCloudRun'

type QueryItem = {
  id: string
  last_queried?: any
  page_id?: string
  query_id?: string
  query_phashes?: string[]
  response?: any
  thumbnail_url?: string
  uploaded_video?: string
}

export default function QueriesDashboard(): React.ReactElement {
  const [items, setItems] = useState<QueryItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbMap, setThumbMap] = useState<Record<string, string | null>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})

  useEffect(() => {
    setLoading(true)
    fetch('/api/queries')
      .then(r => r.json())
      .then(data => setItems(data.items || []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // When items load, fetch signed thumbnail URLs for items that have a thumbnail path
  useEffect(() => {
    if (!items || items.length === 0) return
    items.forEach(async (it) => {
      if (!it.thumbnail_url) return
      // Avoid re-fetching
      if (thumbMap[it.id]) return
      try {
        const res = await fetch(`/api/queries/${it.id}/thumbnail`)
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json()
        setThumbMap(prev => ({ ...prev, [it.id]: json.url }))
      } catch (e) {
        console.warn('Failed to fetch signed thumb for', it.id, e)
        setThumbMap(prev => ({ ...prev, [it.id]: null }))
      }
    })
  }, [items])

  const fetchThumb = async (id: string) => {
    try {
      const res = await fetch(`/api/queries/${id}/thumbnail`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      return json.url as string
    } catch (e) {
      console.error('Thumb fetch failed', e)
      return null
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Queries Dashboard</h1>
      {loading && <div>Loading…</div>}
      {error && <div className="text-red-600">{error}</div>}
      <div className="overflow-auto bg-white rounded p-3 shadow">
        <table className="min-w-full text-sm text-left">
          <thead>
            <tr className="border-b">
              <th className="p-2 font-medium">Query ID</th>
              <th className="p-2 font-medium">Page ID</th>
              <th className="p-2 font-medium">Last Queried</th>
              <th className="p-2 font-medium">Uploaded Video</th>
              <th className="p-2 font-medium">Thumbnail</th>
              <th className="p-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items?.map(item => (
              <React.Fragment key={item.id}>
                <tr className="hover:bg-gray-50 align-top">
                  <td className="p-2 align-top">{item.query_id ?? item.id}</td>
                  <td className="p-2 align-top">{item.page_id ?? '—'}</td>
                  <td className="p-2 align-top">{item.last_queried ? new Date(item.last_queried._seconds ? item.last_queried._seconds * 1000 : item.last_queried).toLocaleString() : '—'}</td>
                  <td className="p-2 align-top">{item.uploaded_video ?? '—'}</td>
                  <td className="p-2 align-top">
                    {item.thumbnail_url ? (
                      thumbMap[item.id] === undefined ? (
                        <span className="text-xs text-gray-500">Loading…</span>
                      ) : thumbMap[item.id] ? (
                        <img src={thumbMap[item.id] as string} alt="thumbnail" className="w-28 h-auto rounded" />
                      ) : (
                        <span className="text-xs text-gray-500">Unavailable</span>
                      )
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                  <td className="p-2 align-top">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] }))} className="px-2 py-1 text-sm bg-indigo-50 text-indigo-700 rounded">{expanded[item.id] ? 'Hide' : 'Show results'}</button>
                      <button
                        onClick={async () => {
                          // Retry handler attached inline to keep code simple; defined below also used elsewhere
                          if (retrying[item.id]) return
                          setRetrying(prev => ({ ...prev, [item.id]: true }))
                          setStatusMap(prev => ({ ...prev, [item.id]: 'Retrying…' }))
                          try {
                            const res = await fetch(`/api/queries/${item.id}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query_id: item.query_id ?? item.id }) })
                            if (!res.ok) throw new Error(await res.text())
                            const json = await res.json()
                            // Replace the response for this item in the UI
                            setItems(prev => prev ? prev.map(it => it.id === item.id ? { ...it, response: json.response, last_queried: new Date().toISOString() } : it) : prev)
                            setStatusMap(prev => ({ ...prev, [item.id]: 'Retry successful' }))
                            setExpanded(prev => ({ ...prev, [item.id]: true }))
                          } catch (e) {
                            console.error('Retry failed', e)
                            setStatusMap(prev => ({ ...prev, [item.id]: 'Retry failed' }))
                          } finally {
                            setRetrying(prev => ({ ...prev, [item.id]: false }))
                            // Clear status after a short delay
                            setTimeout(() => setStatusMap(prev => { const c = { ...prev }; delete c[item.id]; return c }), 4000)
                          }
                        }}
                        className="px-2 py-1 text-sm bg-yellow-50 text-yellow-700 rounded disabled:opacity-50"
                        disabled={!!retrying[item.id]}
                      >
                        {retrying[item.id] ? 'Retrying…' : 'Retry'}
                      </button>
                      {statusMap[item.id] && <span className="text-xs text-gray-600">{statusMap[item.id]}</span>}
                    </div>
                  </td>
                </tr>
                {expanded[item.id] && (
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="p-4">
                      {item.response ? (
                        // Try to find the results array in common locations
                        (() => {
                          const candidates = [
                            item.response.results,
                            item.response.results_full,
                            item.response?.response?.results,
                            item.response?.response?.results_full,
                          ]
                          let raw: any[] | null = null
                          for (const c of candidates) {
                            if (Array.isArray(c)) {
                              raw = c as any[]
                              break
                            }
                          }

                          // If we found an array and it looks like the shape with ad_id/ad_url/total_distance, render a concise table
                          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
                            const rows = raw as any[]
                            const hasAdId = rows.every(r => typeof r.ad_id === 'string' || typeof r.ad_id === 'number')
                            const hasUrl = rows.some(r => typeof r.ad_url === 'string')
                            const hasTotal = rows.some(r => typeof r.total_distance === 'number')
                            if (hasAdId && (hasUrl || hasTotal)) {
                              return (
                                <div className="overflow-auto">
                                  <table className="min-w-full text-sm text-left border-collapse">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="p-2 font-medium">Ad ID</th>
                                        <th className="p-2 font-medium">Ad URL</th>
                                        <th className="p-2 font-medium">Total Distance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map((r, idx) => (
                                        <tr key={r.ad_id ?? idx} className="hover:bg-white">
                                          <td className="p-2 align-top">{String(r.ad_id ?? r.id ?? '')}</td>
                                          <td className="p-2 align-top">{r.ad_url ? <a className="text-indigo-600 break-all" href={r.ad_url} target="_blank" rel="noreferrer">{r.ad_url}</a> : '—'}</td>
                                          <td className="p-2 align-top">{typeof r.total_distance === 'number' ? r.total_distance : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )
                            }
                          }

                          // fallback: show the full response object or raw array
                          const show = raw ?? item.response
                          return <pre className="whitespace-pre-wrap max-h-60 overflow-auto mt-2">{JSON.stringify(show, null, 2)}</pre>
                        })()
                      ) : (
                        <div className="text-sm text-gray-600">No response stored for this query.</div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
