"use client"
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Spinner from './Spinner'

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

type QueryGroup = {
  queryId: string
  pageId: string | null
  ads: TrackerAd[]
  totalAds: number
  stats?: {
    isActive: boolean
    rightsRemaining: number
    hasExceeded: boolean
    totalAds: number
  }
}

export default function TrackerAds(): React.ReactElement {
  const [queries, setQueries] = useState<QueryGroup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingQuery, setRefreshingQuery] = useState<string | null>(null)
  const router = useRouter()

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch('/api/tracker-ads', { headers })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const ads = json.ads ?? {}
      
      console.log('[TrackerAds] Loaded ads from API:', Object.keys(ads).length, 'ads')
      
      // Group ads by queryId
      const queryMap: Record<string, TrackerAd[]> = {}
      Object.keys(ads).forEach(id => {
        const ad = ads[id]
        const queryId = ad.queryId ?? 'default'
        
        console.log('[TrackerAds] Processing ad:', id, 'queryId:', queryId, 'hasPreview:', !!ad.preview, 'hasAdInfo:', !!ad.adInfo)
        
        // Skip ads with default queryId that have no preview/adInfo (old incomplete data)
        if (queryId === 'default' && !ad.preview && !ad.adInfo) {
          console.warn('[TrackerAds] Skipping incomplete ad (no queryId, preview, or adInfo):', id)
          return
        }
        
        if (!queryMap[queryId]) queryMap[queryId] = []
        queryMap[queryId].push({
          id,
          url: ad.url ?? null,
          days: typeof ad.days === 'number' ? ad.days : null,
          addedAt: ad.addedAt ?? null,
          adInfo: ad.adInfo ?? null,
          preview: ad.preview ?? null,
          queryId: ad.queryId ?? 'default',
          pageId: ad.pageId ?? null
        })
      })
      
      // Convert to array of query groups
      const queryGroups: QueryGroup[] = Object.keys(queryMap).map(queryId => ({
        queryId,
        pageId: queryMap[queryId][0]?.pageId ?? null,
        ads: queryMap[queryId],
        totalAds: queryMap[queryId].length
      }))
      
      // Calculate stats from stored data
      const groupsWithStats = queryGroups.map(query => ({
        ...query,
        stats: calculateQueryStats(query, false) // Use stored data by default
      }))
      
      setQueries(groupsWithStats)
    } catch (e: any) {
      console.error('Failed to load tracker ads', e)
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  // Load on mount
  React.useEffect(() => {
    loadData()
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  const handleRefreshQuery = async (query: QueryGroup, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click navigation
    setRefreshingQuery(query.queryId)
    
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = token ? { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      } : { 'Content-Type': 'application/json' }
      
      // Fetch live data for all ads in this query
      const updatedAds = await Promise.all(query.ads.map(async (ad) => {
        try {
          const resp = await fetch(`/api/ad/${encodeURIComponent(ad.id)}`)
          if (!resp.ok) {
            console.warn('[TrackerAds] Failed to fetch live data for ad:', ad.id)
            return ad
          }
          const json = await resp.json()
          const liveAdInfo = json?.adInfo ?? null
          
          // Update Firestore with live data
          await fetch('/api/tracker-ads', {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ adId: ad.id, liveAdInfo })
          })
          
          return { ...ad, liveAdInfo }
        } catch (err) {
          console.error('[TrackerAds] Error fetching live data for ad:', ad.id, err)
          return ad
        }
      }))
      
      // Update the query with new live data and recalculate stats
      setQueries(prev => prev ? prev.map(q => {
        if (q.queryId === query.queryId) {
          const updatedQuery = { ...q, ads: updatedAds }
          return {
            ...updatedQuery,
            stats: calculateQueryStats(updatedQuery, true) // Use live data
          }
        }
        return q
      }) : null)
      
    } catch (err) {
      console.error('[TrackerAds] Error refreshing query:', err)
    } finally {
      setRefreshingQuery(null)
    }
  }

  const calculateQueryStats = (query: QueryGroup, useLiveData = false) => {
    let anyActive = false
    let earliestStart: Date | null = null
    let latestEnd: Date | null = null
    let totalDays = 0
    
    query.ads.forEach(ad => {
      // Use liveAdInfo if available and useLiveData is true, otherwise use stored adInfo
      const adInfo = (useLiveData && ad.liveAdInfo) ? ad.liveAdInfo : ad.adInfo
      
      if (!adInfo) return
      
      // Check isActive key
      if (adInfo.isActive === true) {
        anyActive = true
      }
      
      // Track earliest start and latest end
      const start = adInfo?.startDate ? new Date(adInfo.startDate * 1000) : (adInfo?.startDateString ? new Date(adInfo.startDateString) : null)
      const end = adInfo?.endDate ? new Date(adInfo.endDate * 1000) : (adInfo?.endDateString ? new Date(adInfo.endDateString) : null)
      
      if (start && (!earliestStart || start < earliestStart)) {
        earliestStart = start
      }
      if (end && (!latestEnd || end > latestEnd)) {
        latestEnd = end
      }
      
      // Sum up all days granted
      if (ad.days !== null) {
        totalDays += ad.days
      }
    })
    
    // Calculate total duration from earliest start to latest end
    const MS_PER_DAY = 1000 * 60 * 60 * 24
    const actualDurationDays = (earliestStart && latestEnd) 
      ? Math.max(0, Math.round((latestEnd.getTime() - earliestStart.getTime()) / MS_PER_DAY))
      : null
    
    const rightsRemaining = (totalDays > 0 && actualDurationDays !== null) 
      ? Math.round(totalDays - actualDurationDays) 
      : null
    
    const hasExceeded = rightsRemaining !== null && rightsRemaining < 0
    
    return { 
      isActive: anyActive, 
      rightsRemaining: rightsRemaining ?? 0, 
      hasExceeded,
      totalAds: query.totalAds
    }
  }

  if (loading && !queries) {
    return <div className="flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading...</div>
  }

  if (error) {
    return <div className="text-red-600">{error}</div>
  }

  if (!queries || queries.length === 0) {
    return <div className="text-sm text-gray-600">No tracked queries yet. Run queries from Video Query page.</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button 
          onClick={handleRefresh} 
          disabled={refreshing}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60">
          {refreshing ? (<span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 text-white" /> Refreshing...</span>) : 'Refresh All'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {queries.map((query) => {
          const firstPreview = query.ads.find(ad => ad.preview)?.preview
          const stats = query.stats
          const isRefreshing = refreshingQuery === query.queryId
          
          return (
            <div 
              key={query.queryId} 
              className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow cursor-pointer relative"
              onClick={() => router.push(`/tracker/${encodeURIComponent(query.queryId)}`)}
            >
              {/* Refresh Button */}
              <button
                onClick={(e) => handleRefreshQuery(query, e)}
                disabled={isRefreshing}
                className="absolute top-2 right-2 z-10 p-2 bg-white rounded-full shadow-md hover:bg-gray-100 disabled:opacity-60"
                title="Refresh live status"
              >
                {isRefreshing ? (
                  <Spinner className="h-4 w-4 text-indigo-600" />
                ) : (
                  <span className="text-lg">🔄</span>
                )}
              </button>
              
              {/* Preview Image */}
              <div className="h-48 bg-gray-100 overflow-hidden">
                {firstPreview ? (
                  <img src={firstPreview} alt="Query preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <span className="text-4xl">📷</span>
                  </div>
                )}
              </div>
              
              {/* Card Content */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-semibold text-gray-800 truncate">Query {query.queryId.slice(0, 10)}...</h3>
                  <span className="inline-block px-2 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-semibold">
                    {query.totalAds}
                  </span>
                </div>
                
                {query.pageId && (
                  <div className="text-xs text-gray-600 mb-3 truncate">
                    <strong>Page:</strong> {query.pageId}
                  </div>
                )}
                
                {/* Status and Rights Info */}
                {stats && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Status:</span>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        stats.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {stats.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Rights:</span>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        stats.hasExceeded 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {stats.hasExceeded ? `Exceeded ${Math.abs(stats.rightsRemaining)}d` : `${stats.rightsRemaining}d remaining`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
