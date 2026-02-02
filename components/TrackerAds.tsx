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
  queryThumbnail?: string | null
}

type QueryGroup = {
  queryId: string
  pageId: string | null
  ads: TrackerAd[]
  totalAds: number
  queryThumbnail?: string | null
  phashes?: any
  days?: number | null
  createdAt?: string | null
  lastRefreshed?: string | null
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
  const [deletingQuery, setDeletingQuery] = useState<string | null>(null)
  const [editingQuery, setEditingQuery] = useState<QueryGroup | null>(null)
  const [editDays, setEditDays] = useState<number>(30)
  const [savingDays, setSavingDays] = useState(false)
  const router = useRouter()

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch('/api/queries', { headers })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const items = json.items ?? []
      
      console.log('[TrackerAds] Loaded queries from API:', items.length, 'queries')
      
      // Convert queries to QueryGroup format
      const queryGroups: QueryGroup[] = items.map((query: any) => {
        const trackedAds = query.tracked_ads ?? []
        
        // Filter out empty placeholder ads
        const realAds = trackedAds.filter((ad: any) => !ad.isEmpty)
        
        console.log('[TrackerAds] Processing query:', query.id, 'tracked ads:', realAds.length)
        
        return {
          queryId: query.id,
          pageId: query.page_id || null,
          ads: realAds.map((ad: any) => ({
            id: ad.adId || ad.id,
            url: ad.url ?? null,
            days: query.days ?? null,
            addedAt: ad.addedAt ?? null,
            adInfo: ad.adInfo ?? null,
            preview: ad.preview ?? null,
            queryId: query.id,
            pageId: query.page_id || null,
            liveAdInfo: ad.liveAdInfo ?? null,
            lastFetched: ad.lastFetched ?? null
          })),
          totalAds: realAds.length,
          queryThumbnail: query.thumbnail_url || null,
          phashes: query.response?.phashes || query.response?.query_phashes || 
                   (query.response?.results?.[0]?.ref_phashes) || null,
          days: query.days ?? null,
          createdAt: query.last_queried || query.createdAt || null,
          lastRefreshed: query.last_refreshed || query.last_queried || query.createdAt || null
        }
      })
      
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
          
          // Update Firestore with live data using new API
          await fetch(`/api/queries/${encodeURIComponent(query.queryId)}/track`, {
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

  const handleDeleteQuery = async (query: QueryGroup, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click navigation
    
    if (!confirm(`Delete this query and all ${query.totalAds} tracked ad${query.totalAds === 1 ? '' : 's'}?`)) {
      return
    }
    
    setDeletingQuery(query.queryId)
    
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {}
      
      const resp = await fetch(`/api/queries/${encodeURIComponent(query.queryId)}`, {
        method: 'DELETE',
        headers
      })
      
      if (!resp.ok) {
        throw new Error(await resp.text())
      }
      
      // Remove the query from the UI
      setQueries(prev => prev ? prev.filter(q => q.queryId !== query.queryId) : null)
      
    } catch (err) {
      console.error('[TrackerAds] Error deleting query:', err)
      alert('Failed to delete query. Please try again.')
    } finally {
      setDeletingQuery(null)
    }
  }

  const handleEditQuery = (query: QueryGroup, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click navigation
    setEditingQuery(query)
    setEditDays(query.days ?? 30)
  }

  const handleSaveDays = async () => {
    if (!editingQuery) return
    
    setSavingDays(true)
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
      
      const resp = await fetch(`/api/queries/${encodeURIComponent(editingQuery.queryId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ days: editDays })
      })
      
      if (!resp.ok) {
        throw new Error(await resp.text())
      }
      
      // Update the query in the UI with new days value
      setQueries(prev => prev ? prev.map(q => {
        if (q.queryId === editingQuery.queryId) {
          // Update days in both query and all ads
          const updatedQuery = {
            ...q,
            days: editDays,
            ads: q.ads.map(ad => ({ ...ad, days: editDays }))
          }
          // Recalculate stats with updated data
          return {
            ...updatedQuery,
            stats: calculateQueryStats(updatedQuery, false)
          }
        }
        return q
      }) : null)
      
      setEditingQuery(null)
      
    } catch (err) {
      console.error('[TrackerAds] Error updating days:', err)
      alert('Failed to update days. Please try again.')
    } finally {
      setSavingDays(false)
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
          const stats = query.stats
          const isRefreshing = refreshingQuery === query.queryId
          const isDeleting = deletingQuery === query.queryId
          
          return (
            <div 
              key={query.queryId} 
              className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow cursor-pointer relative"
              onClick={() => router.push(`/tracker/${encodeURIComponent(query.queryId)}`)}
            >
              {/* Action Buttons */}
              <div className="absolute top-2 right-2 z-10 flex gap-2">
                <button
                  onClick={(e) => handleEditQuery(query, e)}
                  disabled={isRefreshing || isDeleting}
                  className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 disabled:opacity-60"
                  title="Edit rights days"
                >
                  <span className="text-lg">✏️</span>
                </button>
                <button
                  onClick={(e) => handleRefreshQuery(query, e)}
                  disabled={isRefreshing || isDeleting}
                  className="p-2 bg-white rounded-full shadow-md hover:bg-gray-100 disabled:opacity-60"
                  title="Refresh live status"
                >
                  {isRefreshing ? (
                    <Spinner className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <span className="text-lg">🔄</span>
                  )}
                </button>
                <button
                  onClick={(e) => handleDeleteQuery(query, e)}
                  disabled={isRefreshing || isDeleting}
                  className="p-2 bg-white rounded-full shadow-md hover:bg-red-50 disabled:opacity-60"
                  title="Delete query"
                >
                  {isDeleting ? (
                    <Spinner className="h-4 w-4 text-red-600" />
                  ) : (
                    <span className="text-lg">🗑️</span>
                  )}
                </button>
              </div>
              
              {/* Preview Image - Use query thumbnail */}
              <div className="h-48 bg-gray-100 overflow-hidden">
                {query.queryThumbnail ? (
                  <img src={query.queryThumbnail} alt="Query video thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <span className="text-4xl">🎥</span>
                  </div>
                )}
              </div>
              
              {/* Card Content */}
              <div className="p-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    {query.createdAt && (
                      <div className="text-xs text-gray-500 mb-1">
                        {new Date(query.createdAt).toLocaleString()}
                      </div>
                    )}
                    {query.lastRefreshed && query.lastRefreshed !== query.createdAt && (
                      <div className="text-xs text-gray-400">
                        Last refreshed: {new Date(query.lastRefreshed).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <span className="inline-block px-2 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-semibold ml-2">
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
                  <div className="space-y-2 mb-3">
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
              
              {/* See full details button */}
              <div className="px-4 pb-4">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    router.push(`/tracker/${encodeURIComponent(query.queryId)}`)
                  }}
                  className="w-full py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
                >
                  See full details
                </button>
              </div>
            </div>
          )
        })}
      </div>
      
      {/* Edit Days Modal */}
      {editingQuery && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setEditingQuery(null)}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Edit Rights Days</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Total Rights Days
              </label>
              <input
                type="number"
                min="1"
                value={editDays}
                onChange={(e) => setEditDays(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={savingDays}
              />
              <p className="text-xs text-gray-500 mt-1">
                Number of days to search back for ads
              </p>
            </div>
            
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingQuery(null)}
                disabled={savingDays}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDays}
                disabled={savingDays || editDays <= 0}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60"
              >
                {savingDays ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="h-4 w-4 text-white" /> Saving...
                  </span>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
