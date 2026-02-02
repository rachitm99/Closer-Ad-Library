"use client"
import React, { useEffect, useState } from 'react'
import Spinner from './Spinner'

type TrackedAd = {
  id: string
  url?: string | null
  days?: number | null
  addedAt?: any
}

export default function TrackedAds(): React.ReactElement {
  const [items, setItems] = useState<TrackedAd[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adInfos, setAdInfos] = useState<Record<string, any>>({})
  const [fetchingAdId, setFetchingAdId] = useState<string | null>(null)
  const [untrackingIds, setUntrackingIds] = useState<Record<string, boolean>>({})
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setLoading(true)
    ;(async () => {
      try {
        const tokenModule = await import('../lib/firebaseClient')
        const token = await tokenModule.getIdToken()
        const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {}
        const res = await fetch('/api/tracked-ads', { headers })
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json()
        const ads = json.ads ?? {}
        const list = Object.keys(ads).map(id => ({ id, url: ads[id]?.url ?? null, days: typeof ads[id]?.days === 'number' ? ads[id].days : null, addedAt: ads[id]?.addedAt ?? null }))
        setItems(list)
        // After we have the list, fetch details for all tracked ads
        if (list.length > 0) await fetchAllAdsInfo(list)
      } catch (e: any) {
        console.error('Failed to load tracked ads', e)
        setError(String(e?.message ?? e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const fetchAd = async (adId: string) => {
    if (!adId) return null
    try {
      const res = await fetch(`/api/ad/${encodeURIComponent(adId)}`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const adInfo = json?.adInfo ?? null
      setAdInfos(prev => ({ ...prev, [adId]: adInfo }))
      return adInfo
    } catch (e) {
      console.warn('Failed to fetch ad info for', adId, e)
      return null
    }
  }

  const fetchAllAdsInfo = async (list?: TrackedAd[]) => {
    const toFetch = list ?? (items ?? [])
    if (!toFetch || toFetch.length === 0) return
    setLoadingAll(true)
    try {
      await Promise.all(toFetch.map(async (it) => {
        try {
          await fetchAd(it.id)
        } catch (e) {
          // ignore per-item failures
        }
      }))
    } finally {
      setLoadingAll(false)
    }
  }

  const refreshOne = async (adId: string) => {
    if (!adId) return
    setRefreshingIds(prev => ({ ...prev, [adId]: true }))
    try {
      await fetchAd(adId)
    } finally {
      setRefreshingIds(prev => { const c = { ...prev }; delete c[adId]; return c })
    }
  }

  const refreshAll = async () => {
    await fetchAllAdsInfo()
  }

  const untrack = async (adId: string) => {
    if (!adId) return
    setUntrackingIds(prev => ({ ...prev, [adId]: true }))
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      const res = await fetch(`/api/tracked-ads?adId=${encodeURIComponent(adId)}`, { method: 'DELETE', headers })
      if (!res.ok) throw new Error(await res.text())
      setItems(prev => prev ? prev.filter(it => it.id !== adId) : prev)
      // remove info cache
      setAdInfos(prev => { const c = { ...prev }; delete c[adId]; return c })
    } catch (e: any) {
      console.error('Untrack failed', e)
      setError(String(e?.message ?? e))
      setTimeout(() => setError(null), 4000)
    } finally {
      setUntrackingIds(prev => { const c = { ...prev }; delete c[adId]; return c })
    }
  }


  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Tracked Ads</h1>
      </div>

      {loading && <div className="flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading…</div>}
      {error && <div className="text-red-600">{error}</div>}

      {items && items.length === 0 && (
        <div className="text-sm text-gray-600">No tracked ads yet. Track results from the Video Query page.</div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-md font-medium">Tracked list</h2>
        <div className="flex items-center gap-2">
          <button onClick={refreshAll} disabled={loadingAll} className="px-3 py-1 text-sm bg-indigo-600 text-white rounded disabled:opacity-60">{loadingAll ? (<span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 text-white" /> Refreshing…</span>) : 'Refresh all'}</button>
        </div>
      </div>

      {loadingAll && (
        <div className="flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading tracked ad details…</div>
      )}

      {!loadingAll && items && items.length > 0 && (
        <div className="bg-white rounded p-3 shadow overflow-auto">
          <table className="min-w-full text-sm text-left">
            <thead>
              <tr className="border-b">
                <th className="p-2 font-medium">Preview</th>
                <th className="p-2 font-medium">Page</th>
                <th className="p-2 font-medium">Start</th>
                <th className="p-2 font-medium">End</th>
                <th className="p-2 font-medium">Rights (days)</th>
                <th className="p-2 font-medium">Rights remaining</th>
                <th className="p-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => {
                const info = adInfos[it.id]
                const preview = info?.snapshot?.videos?.[0]?.video_preview_image_url ?? (Array.isArray(info?.snapshot?.images) ? info.snapshot.images[0] : null)
                const title = info?.snapshot?.title ?? info?.title ?? info?.snapshot?.page_name ?? ''
                const pageName = info?.snapshot?.page_name ?? info?.snapshot?.current_page_name ?? info?.page_name ?? info?.pageName ?? title ?? ''
                const pagePic = info?.snapshot?.page_profile_picture_url ?? info?.snapshot?.page_profile_image_url ?? info?.snapshot?.page_picture_url ?? ''
                const start = info?.startDate ? new Date(info.startDate * 1000) : (info?.startDateString ? new Date(info.startDateString) : null)
                const end = info?.endDate ? new Date(info.endDate * 1000) : (info?.endDateString ? new Date(info.endDateString) : null)
                const MS_PER_DAY = 1000 * 60 * 60 * 24
                const now = new Date()
                const daysUntilEnd = end ? Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY) : null
                const adDurationDays = (start && end) ? Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)) : null
                const rightsRemaining = (it.days !== null && adDurationDays !== null) ? Math.round((it.days || 0) - adDurationDays) : null

                return (
                  <tr key={it.id} className="hover:bg-gray-50 align-top">
                    <td className="p-2 align-top"><div className="w-28 h-16 overflow-hidden rounded bg-gray-100">
                      {preview ? <img src={preview} alt="preview" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">No preview</div>}
                    </div></td>
                    <td className="p-2 align-top">
                      <div className="flex items-center gap-2">
                        {pagePic ? <img src={pagePic} alt={pageName || title} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500">—</div>}
                        <div className="text-sm text-gray-800">{pageName || title || '—'}</div>
                      </div>
                    </td>
                    <td className="p-2 align-top">{start ? start.toLocaleString() : '—'}</td>
                    <td className="p-2 align-top">{end ? end.toLocaleString() : '—'}</td>
                    <td className="p-2 align-top">{it.days ?? '—'}</td>
                    <td className="p-2 align-top">{rightsRemaining !== null ? (rightsRemaining >= 0 ? <span className="inline-block px-2 py-1 rounded bg-green-100 text-green-800">{rightsRemaining}d remaining</span> : <span className="inline-block px-2 py-1 rounded bg-red-100 text-red-800">Exceeded {Math.abs(rightsRemaining)}d</span>) : '—'}</td>
                    <td className="p-2 align-top">
                      <div className="flex items-center gap-2">
                        <button onClick={() => refreshOne(it.id)} disabled={!!refreshingIds[it.id]} className="px-2 py-1 text-sm bg-indigo-50 text-indigo-700 rounded">{refreshingIds[it.id] ? (<span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" />Refreshing</span>) : 'Refresh'}</button>
                        <button onClick={() => untrack(it.id)} disabled={!!untrackingIds[it.id]} className="px-2 py-1 text-sm bg-red-50 text-red-700 rounded disabled:opacity-60">{untrackingIds[it.id] ? 'Removing…' : 'Untrack'}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loadingAll && !loading && items && items.length === 0 && (
        <div className="text-sm text-gray-600">No tracked ads yet. Track results from the Video Query page.</div>
      )}


    </div>
  )
}