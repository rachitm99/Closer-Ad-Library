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
              <th className="p-2 font-medium">Status</th>
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
                  <td className="p-2 align-top">
                    {item.response?.deleted_source === true ? (
                      <span title="Source deleted" className="inline-flex items-center gap-2 px-2 py-1 bg-yellow-50 text-yellow-800 rounded">
                        <span>⚠️</span>
                        <span className="text-xs">Deleted</span>
                      </span>
                    ) : (
                      <span title="OK" className="inline-flex items-center gap-2 px-2 py-1 bg-green-50 text-green-800 rounded">
                        <span>✅</span>
                        <span className="text-xs">OK</span>
                      </span>
                    )}
                  </td>
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
                    <button onClick={() => setExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] }))} className="px-2 py-1 text-sm bg-indigo-50 text-indigo-700 rounded">{expanded[item.id] ? 'Hide' : 'Show results'}</button>
                  </td>
                </tr>
                {expanded[item.id] && (
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="p-4">
                      {item.response ? (
                        (normalizeCloudRunResults(item.response).length === 0) ? (
                          <div className="text-sm text-gray-600">No results</div>
                        ) : (
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
                                {normalizeCloudRunResults(item.response).map(r => (
                                  <tr key={r.id} className="hover:bg-white">
                                    <td className="p-2 align-top">{r.id}</td>
                                    <td className="p-2 align-top">{r.url ? <a className="text-indigo-600 break-all" href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : '—'}</td>
                                    <td className="p-2 align-top">{typeof r.total_distance === 'number' ? r.total_distance : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
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
