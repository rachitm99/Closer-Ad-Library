"use client"
import React, { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Spinner from '../../../components/Spinner'

type TrackerAd = {
  id: string
  url?: string | null
  days?: number | null
  addedAt?: any
  adInfo?: any
  preview?: string | null
  queryId?: string
  pageId?: string | null
  liveAdInfo?: any
  lastFetched?: any
}

export default function QueryDetailPage(): React.ReactElement {
  const router = useRouter()
  const params = useParams()
  const queryId = decodeURIComponent(params.queryId as string)
  
  const [ads, setAds] = useState<TrackerAd[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageId, setPageId] = useState<string | null>(null)

  useEffect(() => {
    loadAds()
  }, [queryId])

  const loadAds = async () => {
    setLoading(true)
    setError(null)
    try {
      const tokenModule = await import('../../../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch('/api/tracker-ads', { headers })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const allAds = json.ads ?? {}
      
      // Filter ads for this query
      const queryAds: TrackerAd[] = []
      Object.keys(allAds).forEach(id => {
        const ad = allAds[id]
        if ((ad.queryId ?? 'default') === queryId) {
          queryAds.push({
            id,
            url: ad.url ?? null,
            days: typeof ad.days === 'number' ? ad.days : null,
            addedAt: ad.addedAt ?? null,
            adInfo: ad.adInfo ?? null,
            preview: ad.preview ?? null,
            queryId: ad.queryId ?? 'default',
            pageId: ad.pageId ?? null,
            liveAdInfo: ad.liveAdInfo ?? null,
            lastFetched: ad.lastFetched ?? null
          })
        }
      })
      
      setAds(queryAds)
      if (queryAds.length > 0) {
        setPageId(queryAds[0].pageId)
      }
    } catch (e: any) {
      console.error('Failed to load ads', e)
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <div className="flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <div className="text-red-600">{error}</div>
      </div>
    )
  }

  if (ads.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <button onClick={() => router.push('/tracker')} className="mb-4 text-indigo-600 hover:underline">&larr; Back to Tracker</button>
        <div className="text-sm text-gray-600">No ads found for this query.</div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <button onClick={() => router.push('/tracker')} className="text-indigo-600 hover:underline mb-2">&larr; Back to Tracker</button>
          <h1 className="text-xl font-semibold">Query Details</h1>
          <div className="text-sm text-gray-600">
            Query ID: {queryId.slice(0, 16)}... {pageId && `• Page: ${pageId}`}
          </div>
        </div>
        <div className="text-sm text-gray-600">
          {ads.length} {ads.length === 1 ? 'ad' : 'ads'} tracked
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="p-3 text-left font-medium">Preview</th>
              <th className="p-3 text-left font-medium">Page</th>
              <th className="p-3 text-left font-medium">Start Date</th>
              <th className="p-3 text-left font-medium">Status</th>
              <th className="p-3 text-left font-medium">Rights (days)</th>
              <th className="p-3 text-left font-medium">Rights Remaining</th>
            </tr>
          </thead>
          <tbody>
            {ads.map(ad => {
              // Use liveAdInfo if available, otherwise use adInfo
              const info = ad.liveAdInfo || ad.adInfo
              const pageName = info?.snapshot?.page_name ?? info?.snapshot?.current_page_name ?? info?.page_name ?? info?.pageName ?? ''
              const pagePic = info?.snapshot?.page_profile_picture_url ?? info?.snapshot?.page_profile_image_url ?? ''
              const start = info?.startDate ? new Date(info.startDate * 1000) : (info?.startDateString ? new Date(info.startDateString) : null)
              const end = info?.endDate ? new Date(info.endDate * 1000) : (info?.endDateString ? new Date(info.endDateString) : null)
              
              const MS_PER_DAY = 1000 * 60 * 60 * 24
              const now = new Date()
              const adDurationDays = (start && end) ? Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)) : null
              const rightsRemaining = (ad.days !== null && adDurationDays !== null) ? Math.round((ad.days || 0) - adDurationDays) : null
              // Check isActive boolean key
              const isActive = info?.isActive === true

              return (
                <tr key={ad.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">
                    <div className="w-24 h-16 overflow-hidden rounded bg-gray-100">
                      {ad.preview ? (
                        <img src={ad.preview} alt="preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">No preview</div>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {pagePic ? (
                        <img src={pagePic} alt={pageName} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-100" />
                      )}
                      <div className="text-sm text-gray-800">{pageName || '—'}</div>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="text-sm text-gray-700">
                      {start ? start.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                      }) : '—'}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      isActive 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-sm text-gray-700">{ad.days ?? '—'}</span>
                  </td>
                  <td className="p-3">
                    {rightsRemaining !== null ? (
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                        rightsRemaining >= 0 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {rightsRemaining >= 0 
                          ? `${rightsRemaining}d remaining` 
                          : `Exceeded ${Math.abs(rightsRemaining)}d`}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
