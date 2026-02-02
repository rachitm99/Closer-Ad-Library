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
  const [phashes, setPhashes] = useState<any>(null)
  const [days, setDays] = useState<number | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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
      
      // Fetch specific query from new API
      const res = await fetch(`/api/queries/${encodeURIComponent(queryId)}`, { headers })
      if (!res.ok) throw new Error(await res.text())
      const query = await res.json()
      
      // Extract tracked ads and metadata
      const trackedAds = query.tracked_ads ?? []
      const realAds = trackedAds.filter((ad: any) => !ad.isEmpty)
      
      const queryAds: TrackerAd[] = realAds.map((ad: any) => ({
        id: ad.adId || ad.id,
        url: ad.url ?? null,
        days: query.days ?? null,
        addedAt: ad.addedAt ?? null,
        adInfo: ad.adInfo ?? null,
        preview: ad.preview ?? null,
        queryId: query.queryId,
        pageId: query.page_id ?? null,
        liveAdInfo: ad.liveAdInfo ?? null,
        lastFetched: ad.lastFetched ?? null
      }))
      
      // Extract phashes from query response
      // First try top-level phashes, then try extracting from first result's ref_phashes
      let queryPhashes = query.response?.phashes || query.response?.query_phashes || null
      
      if (!queryPhashes && query.response?.results?.length > 0) {
        // Extract ref_phashes from the first result as fallback
        const firstResult = query.response.results[0]
        if (firstResult?.ref_phashes) {
          queryPhashes = firstResult.ref_phashes
          console.log('[QueryDetail] Extracted phashes from first result:', queryPhashes)
        }
      }
      
      setAds(queryAds)
      setPhashes(queryPhashes)
      setDays(query.days ?? null)
      setPageId(query.page_id ?? null)
      setLastRefreshed(query.last_refreshed ?? query.last_queried ?? null)
      
      console.log('[QueryDetail] Loaded query:', queryId)
      console.log('[QueryDetail] Found', queryAds.length, 'ads')
      console.log('[QueryDetail] Phashes:', queryPhashes ? 'Found' : 'Not found', queryPhashes)
      console.log('[QueryDetail] Days:', query.days)
      console.log('[QueryDetail] PageId:', query.page_id)
      console.log('[QueryDetail] Full response object:', JSON.stringify(query.response, null, 2))
    } catch (e: any) {
      console.error('Failed to load ads', e)
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    if (!phashes) {
      alert('Cannot refresh: No phashes found for this query.')
      return
    }
    
    setRefreshing(true)
    try {
      const tokenModule = await import('../../../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      
      // Use phashes to query for new matches
      const queryRes = await fetch('/api/query-phashes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ 
          phashes, 
          pageId, 
          days,
          last_refreshed: lastRefreshed // Pass to GCP for filtering
        })
      })
      
      if (!queryRes.ok) {
        throw new Error('Query failed: ' + await queryRes.text())
      }
      
      const raw = await queryRes.json()
      const { normalizeCloudRunResults } = await import('../../../lib/normalizeCloudRun')
      const normalized = normalizeCloudRunResults(raw)
      const filtered = normalized.filter(r => typeof r.total_distance === 'number' && r.total_distance === 0)
      
      console.log('[QueryDetail] Found', filtered.length, 'new matches')
      
      // Update last_refreshed timestamp in query document
      const headers: Record<string,string> = {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
      
      await fetch(`/api/queries/${encodeURIComponent(queryId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ update_refresh_time: true })
      })
      
      // Track new ads (will not duplicate existing ones due to .set() in track route)
      await Promise.all(filtered.map(async (r) => {
        try {
          // Fetch full ad data first
          const adResp = await fetch(`/api/ad/${encodeURIComponent(r.id)}`)
          let adInfo = null
          let preview = null
          
          if (adResp.ok) {
            const adJson = await adResp.json()
            adInfo = adJson?.adInfo ?? null
            preview = adInfo?.snapshot?.videos?.[0]?.video_preview_image_url ?? 
                     (Array.isArray(adInfo?.snapshot?.videos) ? 
                      adInfo.snapshot.videos.find((v:any) => v.video_preview_image_url)?.video_preview_image_url : null)
          }
          
          await fetch(`/api/queries/${encodeURIComponent(queryId)}/track`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              adId: r.id,
              adInfo,
              preview,
              isEmpty: false
            })
          })
        } catch (err) {
          console.warn('[QueryDetail] Failed to track ad:', r.id, err)
        }
      }))
      
      // Reload ads
      await loadAds()
      
    } catch (err: any) {
      console.error('[QueryDetail] Refresh failed:', err)
      alert('Refresh failed: ' + (err?.message || 'Unknown error'))
    } finally {
      setRefreshing(false)
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
        <button onClick={() => router.push('/tracker')} className="mb-4 text-indigo-600 hover:underline">&larr; Back to All Videos</button>
        <div className="mb-4">
          <h1 className="text-xl font-semibold mb-2">No ads found</h1>
          <div className="text-sm text-gray-600">
            Query ID: {queryId.slice(0, 16)}... {pageId && `• Page: ${pageId}`}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || !phashes}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
          title={!phashes ? 'Phashes not found - cannot refresh' : 'Refresh to find new matches'}
        >
          {refreshing ? (
            <>
              <Spinner className="h-4 w-4 text-white" />
              Searching for new matches...
            </>
          ) : !phashes ? (
            <>
              🔄 Refresh unavailable (no phashes)
            </>
          ) : (
            <>
              🔄 Refresh to find new matches
            </>
          )}
        </button>
        {!phashes && (
          <div className="mt-2 text-xs text-red-600">
            Note: Query phashes are missing. Please ensure your GCP API returns phashes in the response.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <button onClick={() => router.push('/tracker')} className="text-indigo-600 hover:underline mb-2">&larr; Back to All Videos</button>
          <h1 className="text-xl font-semibold">Query Details</h1>
          <div className="text-sm text-gray-600">
            Query ID: {queryId.slice(0, 16)}... {pageId && `• Page: ${pageId}`}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleRefresh}
            disabled={refreshing || !phashes}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
            title={!phashes ? 'Phashes not found - cannot refresh' : 'Refresh to find new matches'}
          >
            {refreshing ? (
              <>
                <Spinner className="h-4 w-4 text-white" />
                Refreshing...
              </>
            ) : !phashes ? (
              <>
                🔄 Refresh unavailable
              </>
            ) : (
              <>
                🔄 Refresh
              </>
            )}
          </button>
          <div className="text-sm text-gray-600">
            {ads.length} {ads.length === 1 ? 'ad' : 'ads'} tracked
          </div>
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
