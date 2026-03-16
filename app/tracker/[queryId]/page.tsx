"use client"
import React, { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Spinner from '../../../components/Spinner'

const MS_PER_DAY = 1000 * 60 * 60 * 24

function getAdStartDate(info: any): Date | null {
  if (info?.startDate) {
    return new Date(Number(info.startDate) * 1000)
  }

  if (info?.startDateString) {
    const parsed = new Date(info.startDateString)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function getRightsRemaining(totalDays: number | null, startDate: Date | null): number | null {
  if (totalDays === null || startDate === null) {
    return null
  }

  const elapsedDays = Math.max(0, Math.round((Date.now() - startDate.getTime()) / MS_PER_DAY))
  return Math.round(totalDays - elapsedDays)
}

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
  // Oldest ad start (used to calculate rights countdown for the whole card)
  const [oldestAdStart, setOldestAdStart] = useState<Date | null>(null)
  const queryRightsRemaining = getRightsRemaining(days, oldestAdStart)

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
      
      // DEV ONLY: Show raw JSON response
      if (process.env.NODE_ENV === 'development') {
        console.log('[DEV] Raw query response:', JSON.stringify(query, null, 2))
        // Store raw response in state for rendering
        ;(window as any).__devQueryResponse = query
      }
      
      // Extract tracked ads and metadata
      const trackedAds = query.tracked_ads ?? []
      // Filter out placeholder/empty tracked ads that have no adInfo, preview, or liveAdInfo
      const realAds = trackedAds.filter((ad: any) => !ad.isEmpty && (ad.adInfo || ad.preview || ad.liveAdInfo))
      
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

      let earliestTs: number | null = null
      for (const a of queryAds) {
        const info = a.liveAdInfo || a.adInfo
        const startDate = getAdStartDate(info)
        const ts = startDate ? startDate.getTime() : null
        if (ts !== null && (!earliestTs || ts < earliestTs)) earliestTs = ts
      }
      setOldestAdStart(earliestTs ? new Date(earliestTs) : null)

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
        let errorMessage = 'Refresh failed. Please try again.'
        try {
          const errorText = await queryRes.text()
          let errorData: any
          try {
            errorData = JSON.parse(errorText)
          } catch {
            errorData = { detail: errorText }
          }
          
          const detail = errorData?.detail || errorData?.message || errorText || ''
          
          // Map specific error cases to user-friendly messages
          if (detail.includes('Failed to generate') && detail.includes('phashes')) {
            errorMessage = 'No faces found in video. Please upload a video with visible faces.'
          } else if (detail.includes('Face extraction failed')) {
            errorMessage = 'No faces found in video. Please upload a video with visible faces.'
          } else if (detail.includes('phashes must be a non-empty list')) {
            errorMessage = 'No faces found in video. Please upload a video with visible faces.'
          } else if (detail.includes('page_id is required')) {
            errorMessage = 'Brand name error. Please check your brand selection.'
          } else if (detail.includes('Query document') && detail.includes('not found')) {
            errorMessage = 'Query not found. Please try again.'
          } else if (detail.includes('Stored query missing')) {
            errorMessage = 'Query data incomplete. Please try again.'
          } else if (detail.includes('Failed to fetch stored query')) {
            errorMessage = 'Failed to fetch query data. Please try again.'
          }
        } catch {
          // If parsing fails, use default message
        }
        throw new Error(errorMessage)
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
      <div className="max-w-3xl sm:max-w-5xl mx-auto p-4">
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

  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* DEV ONLY: Show raw JSON response */}
      {process.env.NODE_ENV === 'development' && (window as any).__devQueryResponse && (
        <details className="mb-6 bg-gray-50 border border-gray-300 rounded p-4">
          <summary className="cursor-pointer font-semibold text-gray-700 hover:text-gray-900">
            🔍 DEV: Raw JSON Response
          </summary>
          <pre className="mt-4 text-xs bg-white p-4 rounded border border-gray-200 overflow-x-auto max-h-96 overflow-y-auto">
            {JSON.stringify((window as any).__devQueryResponse, null, 2)}
          </pre>
        </details>
      )}
      
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-indigo-700">Rights Days</div>
          <div className="mt-1 text-2xl font-semibold text-indigo-950">{days ?? '—'}</div>
          <div className="mt-1 text-xs text-indigo-700">One query-level value shared across all ads</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-600">Countdown Start</div>
          <div className="mt-1 text-base font-semibold text-gray-900">
            {oldestAdStart ? oldestAdStart.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            }) : '—'}
          </div>
          <div className="mt-1 text-xs text-gray-500">Calculated from the earliest ad start date</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-600">Rights Remaining</div>
          <div className="mt-2">
            {queryRightsRemaining !== null ? (
              <span className={`inline-block px-2.5 py-1 rounded text-sm font-semibold ${
                queryRightsRemaining >= 0
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {queryRightsRemaining >= 0
                  ? `${queryRightsRemaining}d remaining`
                  : `Exceeded ${Math.abs(queryRightsRemaining)}d`}
              </span>
            ) : (
              <span className="text-sm text-gray-500">—</span>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">This is shown once for the whole query</div>
        </div>
      </div>

      {ads.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-gray-400 text-5xl mb-4">📭</div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">No ads found yet</h3>
          <p className="text-indigo-600 font-medium">
            Come back later and click the Refresh button to check for new matches!
          </p>
          {process.env.NODE_ENV === 'development' && (window as any).__devQueryResponse && (
            <details className="mt-6 text-left">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-semibold text-sm">🔍 DEV: Raw Query Response</summary>
              <pre className="mt-3 text-xs bg-gray-50 p-3 rounded border overflow-x-auto max-h-64 overflow-y-auto text-left">{JSON.stringify((window as any).__devQueryResponse, null, 2)}</pre>
            </details>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-3 text-left font-medium">Preview</th>
                <th className="p-3 text-left font-medium">Page</th>
                <th className="p-3 text-left font-medium">Start Date</th>
                <th className="p-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ads.map(ad => {
                // Use liveAdInfo if available, otherwise use adInfo
                const info = ad.liveAdInfo || ad.adInfo
                const pageName = info?.snapshot?.page_name ?? info?.snapshot?.current_page_name ?? info?.page_name ?? info?.pageName ?? ''
                const pagePic = info?.snapshot?.page_profile_picture_url ?? info?.snapshot?.page_profile_image_url ?? ''
                const start = getAdStartDate(info)

                // Check isActive boolean key
                const isActive = info?.isActive === true

                return (
                  <React.Fragment key={ad.id}>
                    <tr className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <div className="w-24 h-16 overflow-hidden rounded bg-gray-100">
                          {ad.preview ? (
                          ad.url ? (
                            <a href={ad.url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
                              <img src={ad.preview} alt="preview" className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <img src={ad.preview} alt="preview" className="w-full h-full object-cover" />
                          )
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
                        {ad.url ? (
                          <a href={ad.url} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-800 hover:underline">{pageName || '—'}</a>
                        ) : (
                          <div className="text-sm text-gray-800">{pageName || '—'}</div>
                        )}
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
                  </tr>
                  {process.env.NODE_ENV === 'development' && (
                    <tr className="border-b bg-gray-50">
                      <td colSpan={4} className="p-3">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-semibold">🔍 DEV: Raw Ad Data</summary>
                          <pre className="mt-2 bg-white p-2 rounded border overflow-x-auto max-h-48 overflow-y-auto">{JSON.stringify(ad, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked list */}
      <div className="sm:hidden space-y-3 mt-4">
        {ads.map(ad => {
          const info = ad.liveAdInfo || ad.adInfo
          const pageName = info?.snapshot?.page_name ?? info?.snapshot?.current_page_name ?? info?.page_name ?? info?.pageName ?? ''
          const pagePic = info?.snapshot?.page_profile_picture_url ?? info?.snapshot?.page_profile_image_url ?? ''
          const start = getAdStartDate(info)
          const isActive = info?.isActive === true

          return (
            <div key={ad.id} className="bg-white rounded p-3 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-24 h-12 overflow-hidden rounded bg-gray-100 flex-shrink-0">
                  {ad.preview ? (ad.url ? <a href={ad.url} target="_blank" rel="noopener noreferrer" className="block w-full h-full"><img src={ad.preview} alt="preview" className="w-full h-full object-cover" /></a> : <img src={ad.preview} alt="preview" className="w-full h-full object-cover" />) : <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">No preview</div>}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {pagePic ? <img src={pagePic} alt={pageName} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-gray-100" />}
                    {ad.url ? (
                      <a href={ad.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline">{pageName || '—'}</a>
                    ) : (
                      <div className="text-sm font-semibold">{pageName || '—'}</div>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    <div><strong>Start:</strong> {start ? start.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</div>
                    <div><strong>Status:</strong> <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{isActive ? 'Active' : 'Inactive'}</span></div>
                  </div>
                </div>
              </div>
              {process.env.NODE_ENV === 'development' && (
                <details className="mt-3 text-xs border-t pt-2">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-900 font-semibold">🔍 DEV: Raw Ad Data</summary>
                  <pre className="mt-2 bg-gray-50 p-2 rounded border overflow-x-auto max-h-48 overflow-y-auto">{JSON.stringify(ad, null, 2)}</pre>
                </details>
              )}
            </div>
          )
        })}
      </div>
        </div>
      )}
    </div>
  )
}
