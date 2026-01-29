"use client"
import React, { useEffect, useState } from 'react'
import { normalizeCloudRunResults, NormalizedResult } from '../lib/normalizeCloudRun'
import Link from 'next/link'
import AdModal from './AdModal'
import Spinner from './Spinner'

type QueryItem = {
  id: string
  last_queried?: any
  page_id?: string
  query_id?: string
  query_phashes?: string[]
  response?: any
  thumbnail_url?: string
  uploaded_video?: string
  days?: number | null
}

export default function QueriesDashboard(): React.ReactElement {
  const [items, setItems] = useState<QueryItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbMap, setThumbMap] = useState<Record<string, string | null>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})

  // Preview images & ad info per query
  const [imageItemsByQuery, setImageItemsByQuery] = useState<Record<string, { id: string, src: string }[]>>({})
  const [adInfosByQuery, setAdInfosByQuery] = useState<Record<string, Record<string, any>>>({})
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({})
  const [previewError, setPreviewError] = useState<Record<string, string>>({})
  const [activeAd, setActiveAd] = useState<{ id: string, adInfo: any, rightsDays?: number | null } | null>(null)
  // tracked ads state and filter (stores days or null)
  const [trackedAds, setTrackedAds] = useState<Record<string, number | null>>({})
  const [showTrackedOnly, setShowTrackedOnly] = useState(false)
  // ID of ad currently being fetched for preview modal
  const [fetchingAdId, setFetchingAdId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    ;(async () => {
      try {
        const tokenModule = await import('../lib/firebaseClient')
        const token = await tokenModule.getIdToken()
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
        const r = await fetch('/api/queries', { headers })
        if (r.status === 401) {
          setError('You must sign in to view your queries. Use the Sign in button in the header.')
          setItems([])
          return
        }
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json()
        setItems(data.items || [])

        // after loading items, also fetch tracked ads for the user so we can filter
        const tRes = await fetch('/api/tracked-ads', { headers })
        if (tRes.ok) {
          const tJson = await tRes.json()
          const ads = tJson.ads ?? {}
          setTrackedAds(Object.keys(ads).reduce((acc: Record<string,number|null>, k: string) => { acc[k] = ads[k]?.days ?? null; return acc }, {}))
        }
      } catch (e: any) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    })()
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

  // Load preview images & ad info for a given query item
  const loadPreviewsForItem = async (item: QueryItem) => {
    if (!item || !item.id) return
    if (imageItemsByQuery[item.id] !== undefined) return // already loaded
    try {
      setPreviewLoading(prev => ({ ...prev, [item.id]: true }))
      setPreviewError(prev => { const c = { ...prev }; delete c[item.id]; return c })

      // Find raw results array from response (reuse same search logic)
      const candidates = [
        item.response?.results,
        item.response?.results_full,
        item.response?.response?.results,
        item.response?.response?.results_full,
      ]
      let raw: any[] | null = null
      for (const c of candidates) {
        if (Array.isArray(c)) { raw = c as any[]; break }
      }
      if (!raw || raw.length === 0) {
        setImageItemsByQuery(prev => ({ ...prev, [item.id]: [] }))
        setAdInfosByQuery(prev => ({ ...prev, [item.id]: {} }))
        return
      }

      // fetch latest ad info for a specific ad and open modal (delegates to component-scope function)

      const normalized = normalizeCloudRunResults({ results: raw })
      const filtered = normalized.filter(r => typeof r.total_distance === 'number' && r.total_distance < 50)
      if (filtered.length === 0) {
        setImageItemsByQuery(prev => ({ ...prev, [item.id]: [] }))
        setAdInfosByQuery(prev => ({ ...prev, [item.id]: {} }))
        return
      }

      const itemsRes = await Promise.all(filtered.map(async (r) => {
        try {
          const resp = await fetch(`/api/ad/${encodeURIComponent(r.id)}`)
          if (!resp.ok) {
            console.error('Ad fetch failed for', r.id, await resp.text())
            return { id: r.id, preview: null, adInfo: null }
          }
          const json = await resp.json()
          const adInfo = json?.adInfo ?? null
          const preview = adInfo?.snapshot?.videos?.[0]?.video_preview_image_url ?? (Array.isArray(adInfo?.snapshot?.videos) ? adInfo.snapshot.videos.find((v:any) => v.video_preview_image_url)?.video_preview_image_url : null)
          return { id: r.id, preview: preview ?? null, adInfo }
        } catch (e) {
          console.error('Ad fetch error for', r.id, e)
          return { id: r.id, preview: null, adInfo: null }
        }
      }))

      const valid = itemsRes.filter(i => i.preview)
      setImageItemsByQuery(prev => ({ ...prev, [item.id]: valid.map(i => ({ id: i.id, src: i.preview! })) }))
      setAdInfosByQuery(prev => ({ ...prev, [item.id]: valid.reduce((acc:any, i) => { acc[i.id] = i.adInfo; return acc }, {}) }))
    } catch (e: any) {
      console.error('Preview load failed', e)
      setPreviewError(prev => ({ ...prev, [item.id]: String(e?.message ?? e) }))
    } finally {
      setPreviewLoading(prev => ({ ...prev, [item.id]: false }))
    }
  }

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

  // Fetch latest ad info for a specific ad and open modal (component scope)
  const fetchAdAndOpenFromQuery = async (item: QueryItem, adId: string) => {
    if (!adId || !item) return
    setFetchingAdId(adId)
    try {
      const res = await fetch(`/api/ad/${encodeURIComponent(adId)}`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const adInfo = json?.adInfo ?? null
      setAdInfosByQuery(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), [adId]: adInfo } }))
      setActiveAd({ id: adId, adInfo, rightsDays: item.days ?? null })
    } catch (e: any) {
      console.error('Failed to fetch ad info', e)
      setPreviewError(prev => ({ ...prev, [item.id]: String(e?.message ?? e) }))
    } finally {
      setFetchingAdId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Queries Dashboard</h1>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-indigo-600 hover:underline">Video Query (Home)</Link>
          <Link href="/link-query" className="text-sm text-indigo-600 hover:underline">Link Query</Link>
          <label className="inline-flex items-center gap-2 text-sm ml-4">
            <input type="checkbox" checked={showTrackedOnly} onChange={(e) => setShowTrackedOnly(e.target.checked)} />
            <span>Show tracked only</span>
          </label>
        </div>
      </div>
      {loading && <div className="flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> <div>Loading…</div></div>}
      {error && <div className="text-red-600">{error}</div>}
      <div className="overflow-auto bg-white rounded p-3 shadow">
        <table className="min-w-full text-sm text-left">
          <thead>
            <tr className="border-b">
              <th className="p-2 font-medium">Query ID</th>
              <th className="p-2 font-medium">Page ID</th>
              <th className="p-2 font-medium">Days</th>
              <th className="p-2 font-medium">Last Queried</th>
              <th className="p-2 font-medium">Uploaded Video</th>
              <th className="p-2 font-medium">Thumbnail</th>
              <th className="p-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items?.filter(item => {
              if (!showTrackedOnly) return true
              // quick check: see if this query contains at least one tracked ad
              try {
                const candidates = [
                  item.response?.results,
                  item.response?.results_full,
                  item.response?.response?.results,
                  item.response?.response?.results_full,
                ]
                for (const c of candidates) {
                  if (!Array.isArray(c)) continue
                  for (const r of c) {
                    const id = String(r.id ?? r.page_id ?? r.ad_id ?? '')
                    if (id && trackedAds[id] != null) return true
                  }
                }
              } catch (e) {
                // ignore and fall through
              }
              return false
            }).map(item => (
              <React.Fragment key={item.id}>
                <tr className="hover:bg-gray-50 align-top">
                  <td className="p-2 align-top">{item.query_id ?? item.id}</td>
                  <td className="p-2 align-top">{item.page_id ?? '—'}</td>
                  <td className="p-2 align-top">{item.days ?? '—'}</td>
                  <td className="p-2 align-top">{item.last_queried ? new Date(item.last_queried._seconds ? item.last_queried._seconds * 1000 : item.last_queried).toLocaleString() : '—'}</td>
                  <td className="p-2 align-top">{item.uploaded_video ?? '—'}</td>
                  <td className="p-2 align-top">
                    {item.thumbnail_url ? (
                      thumbMap[item.id] === undefined ? (
                        <span className="text-xs text-gray-500 flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading…</span>
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
                      <button onClick={async () => {
                          const willExpand = !expanded[item.id]
                          setExpanded(prev => ({ ...prev, [item.id]: willExpand }))
                          if (willExpand) {
                            // load previews when expanded
                            if (!imageItemsByQuery[item.id] && item.response) await loadPreviewsForItem(item)
                          }
                        }} className="px-2 py-1 text-sm bg-indigo-50 text-indigo-700 rounded">{expanded[item.id] ? 'Hide' : 'Show results'}</button>
                      <button
                        onClick={async () => {
                          // Retry handler attached inline to keep code simple; defined below also used elsewhere
                          if (retrying[item.id]) return
                          setRetrying(prev => ({ ...prev, [item.id]: true }))
                          setStatusMap(prev => ({ ...prev, [item.id]: 'Retrying…' }))
                          try {
                            const tokenModule = await import('../lib/firebaseClient')
                            const token = await tokenModule.getIdToken()
                            const headers: Record<string, string> = { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
                            const res = await fetch(`/api/queries/${item.id}/retry`, { method: 'POST', headers, body: JSON.stringify({ query_id: item.query_id ?? item.id }) })
                            if (!res.ok) throw new Error(await res.text())
                            const json = await res.json()
                            // Replace the response for this item in the UI
                            setItems(prev => prev ? prev.map(it => it.id === item.id ? { ...it, response: json.response, last_queried: new Date().toISOString() } : it) : prev)
                            setStatusMap(prev => ({ ...prev, [item.id]: 'Retry successful' }))
                            setExpanded(prev => ({ ...prev, [item.id]: true }))
                          } catch (e: any) {
                            console.error('Retry failed', e)
                            const msg = e?.message ?? String(e)
                            setStatusMap(prev => ({ ...prev, [item.id]: `Retry failed: ${msg}` }))
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
                        <div>
                          {previewLoading[item.id] ? (
                            <div className="text-sm text-gray-600 flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading preview images…</div>
                          ) : previewError[item.id] ? (
                            <div className="text-sm text-red-600">{previewError[item.id]}</div>
                          ) : imageItemsByQuery[item.id] !== undefined ? (
                            (() => {
                              const displayed = (imageItemsByQuery[item.id] || []).filter(it => !showTrackedOnly || trackedAds[it.id] != null)
                              if (displayed.length === 0) return (<div className="text-sm text-gray-500">No preview images found for results under threshold.</div>)
                              return (
                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                  {displayed.map((it, idx) => (
                                    <div key={`${it.id}-${idx}`} className="relative">
                                      <button onClick={() => fetchAdAndOpenFromQuery(item, it.id)} className="p-0 m-0 border-0 bg-transparent w-full">
                                        <img src={it.src} alt={`Ad preview ${idx + 1}`} className="w-full h-48 object-cover rounded-md shadow-sm cursor-pointer" />
                                      </button>
                                      {fetchingAdId === it.id ? (
                                        <div className="absolute inset-0 bg-black bg-opacity-30 rounded-md flex items-center justify-center">
                                          <Spinner className="h-6 w-6 text-white" />
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              )
                            })()
                          ) : (
                            // no preview info available yet
                            <div className="text-sm text-gray-500">No preview images available.</div>
                          )}
                        </div>
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

      {activeAd ? (
        <AdModal adInfo={activeAd.adInfo} onClose={() => setActiveAd(null)} adId={activeAd.id} rightsDays={activeAd.rightsDays ?? null} />
      ) : null}

    </div>
  )
}
