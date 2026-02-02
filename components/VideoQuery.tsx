"use client"
import React, { useState, useRef } from 'react'

import { normalizeCloudRunResults, NormalizedResult } from '../lib/normalizeCloudRun'
import AdModal from './AdModal'
import Spinner from './Spinner'

export default function VideoQuery(): React.ReactElement {
  const [pageId, setPageId] = useState('')
  // Number of days to search back (default 30)
  const [days, setDays] = useState<number>(30)
  const [file, setFile] = useState<File | null>(null)
  // We'll upload files to GCS by default and notify the server (avoids Vercel payload limits)
  const [progress, setProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [gcsPath, setGcsPath] = useState<string | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<NormalizedResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [imageItems, setImageItems] = useState<{ id: string, src: string }[] | null>(null)
  const [adInfos, setAdInfos] = useState<Record<string, any> | null>(null)
  const [activeAdId, setActiveAdId] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)

  // Tracked ads (ids) for the current user — store days if available (number|null)
  const [trackedAds, setTrackedAds] = useState<Record<string, number | null>>({})
  // Per-ad loading indicator for track/untrack actions
  const [trackedLoading, setTrackedLoading] = useState<Record<string, boolean>>({})
  // Delayed spinner timeouts to avoid flicker on fast responses
  const trackedLoadingTimeoutRef = useRef<Record<string, number | null>>({})
  // ID of ad currently being fetched for detailed view
  const [fetchingAdId, setFetchingAdId] = useState<string | null>(null)

  // Cleanup pending timeouts on unmount
  React.useEffect(() => {
    return () => {
      for (const k of Object.keys(trackedLoadingTimeoutRef.current || {})) {
        const t = trackedLoadingTimeoutRef.current[k]
        if (t) {
          clearTimeout(t)
          trackedLoadingTimeoutRef.current[k] = null
        }
      }
    }
  }, [])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [copySuccess, setCopySuccess] = useState<string>('')
  // Thumbnail for the selected video file (data URL)
  const [fileThumbnail, setFileThumbnail] = useState<string | null>(null)

  // Generate a thumbnail (data URL) from the selected video file for preview
  React.useEffect(() => {
    if (!file) {
      setFileThumbnail(null)
      return
    }
    let cancelled = false
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url

    const generate = async () => {
      try {
        // Wait for metadata and at least one frame
        await new Promise<void>((resolve, reject) => {
          const onloaded = () => resolve()
          const onerror = () => reject(new Error('Failed to load video for thumbnail'))
          video.addEventListener('loadeddata', onloaded, { once: true })
          video.addEventListener('error', onerror, { once: true })
        })

        // Seek to a small offset to avoid black first frames
        const seekTo = Math.min(0.5, (video.duration || 0) / 2)
        video.currentTime = seekTo
        await new Promise<void>((resolve, reject) => {
          const onseeked = () => resolve()
          const onerror = () => reject(new Error('Failed to seek video for thumbnail'))
          video.addEventListener('seeked', onseeked, { once: true })
          video.addEventListener('error', onerror, { once: true })
        })

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 320
        canvas.height = video.videoHeight || 180
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
          if (!cancelled) setFileThumbnail(dataUrl)
        }
      } catch (err) {
        console.error('Thumbnail generation failed', err)
        if (!cancelled) setFileThumbnail(null)
      } finally {
        URL.revokeObjectURL(url)
      }
    }

    generate()
    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file])

  // Search-related state
  type SearchResult = {
    page_id: string
    name: string
    image_uri?: string
    ig_username?: string | null
    category?: string
  }
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [selectedBrand, setSelectedBrand] = useState<SearchResult | null>(null)
  const brandInputRef = useRef<HTMLInputElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [keepDropdownOpen, setKeepDropdownOpen] = useState(false)
  const [dropdownWidth, setDropdownWidth] = useState<number | null>(null)
  const [dropdownLeft, setDropdownLeft] = useState<number | null>(null)
  const inFlightSearches = useRef(0)
  // ID for the latest search request to ignore stale responses
  const latestSearchIdRef = useRef(0)
  // Cache successful search results by normalized query to avoid showing transient empty results
  const searchCacheRef = useRef<Map<string, SearchResult[]>>(new Map())
  // Abort controller for the current in-flight brand search so we can cancel stale requests
  const brandSearchAbortRef = useRef<AbortController | null>(null)

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setResults(null)
    setError(null)
    // focus brand input for quick next step
    setTimeout(() => brandInputRef.current?.focus(), 0)
  }

  const [dragActive, setDragActive] = useState(false)
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragActive(true) }
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragActive(false) }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer?.files?.[0] ?? null
    if (f) {
      setFile(f)
      setResults(null)
      setError(null)
      // focus brand input for quick next step
      setTimeout(() => brandInputRef.current?.focus(), 0)
    }
  }
  const onDropClick = () => {
    if (fileInputRef.current) fileInputRef.current.click()
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!file) return setError('Please pick a video file to upload')
    if (!pageId) return setError('Please select a brand (required)')



    setLoading(true)
    setStatusMessage('Preparing upload to GCS...')
    setResults(null)
    try {
      // Request a signed upload URL from the server
      const upReq = await fetch('/api/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, contentType: file.type || 'video/mp4' }) })
      if (!upReq.ok) throw new Error(`Upload URL request failed: ${upReq.status}`)
      const { uploadUrl, gcsPath } = await upReq.json()
      setGcsPath(gcsPath)

      setStatusMessage('Uploading file to GCS...')
      setIsUploading(true)
      // PUT to signed URL with XHR to track progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed: ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(file)
      })

      setStatusMessage('Notifying server...')
      // Validate days: must be positive integer
      if (!Number.isInteger(days) || days <= 0) throw new Error('Days must be a positive integer')
      // Notify our server to call Cloud Run with the GCS path and days
      const notifyRes = await fetch('/api/query-gcs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gcsPath, pageId, days }) })
      if (!notifyRes.ok) {
        const txt = await notifyRes.text()
        throw new Error(`Server query failed: ${notifyRes.status} ${txt}`)
      }
      const raw = await notifyRes.json()
      // Normalize different possible response shapes into a consistent UI-friendly array
      const normalized = normalizeCloudRunResults(raw)
      // Filter to results with distance exactly 0
      const filtered = normalized.filter(r => typeof r.total_distance === 'number' && r.total_distance === 0)
      setResults(filtered)
      setImageItems(null)
      setAdInfos(null)
      setActiveAdId(null)
      if (filtered.length === 0) {
        setStatusMessage('No results with exact match (distance = 0).')
      } else {
        setStatusMessage('Fetching ad preview images and auto-tracking...')
        setImageLoading(true)
        try {
          const items = await Promise.all(filtered.map(async (r) => {
            try {
              const resp = await fetch(`/api/ad/${encodeURIComponent(r.id)}`)
              if (!resp.ok) {
                console.error('Ad fetch failed for', r.id, await resp.text())
                return { id: r.id, preview: null, adInfo: null }
              }
              const json = await resp.json()
              const adInfo = json?.adInfo ?? null
              const preview = adInfo?.snapshot?.videos?.[0]?.video_preview_image_url ?? (Array.isArray(adInfo?.snapshot?.videos) ? adInfo.snapshot.videos.find((v:any) => v.video_preview_image_url)?.video_preview_image_url : null)
              
              // Auto-track this ad with full info
              try {
                const tokenModule = await import('../lib/firebaseClient')
                const token = await tokenModule.getIdToken()
                const headers: Record<string,string> = { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
                
                // Generate a proper queryId from response or create a unique one based on pageId and timestamp
                const generatedQueryId = `${pageId}-${Date.now()}`
                
                console.log('[VideoQuery] Auto-tracking ad:', r.id, 'with queryId:', generatedQueryId, 'pageId:', pageId)
                
                const trackResponse = await fetch('/api/tracker-ads', { 
                  method: 'POST', 
                  headers, 
                  body: JSON.stringify({ 
                    adId: r.id, 
                    adInfo, 
                    preview,
                    queryId: generatedQueryId,
                    pageId,
                    days 
                  }) 
                })
                
                if (trackResponse.ok) {
                  console.log('[VideoQuery] Successfully tracked ad:', r.id)
                } else {
                  console.error('[VideoQuery] Track failed:', r.id, await trackResponse.text())
                }
              } catch (trackErr) {
                console.warn('Auto-track failed for', r.id, trackErr)
              }
              
              return { id: r.id, preview: preview ?? null, adInfo }
            } catch (e) {
              console.error('Ad fetch error for', r.id, e)
              return { id: r.id, preview: null, adInfo: null }
            }
          }))
          const valid = items.filter(i => i.preview)
          setImageItems(valid.map(i => ({ id: i.id, src: i.preview! })))
          setAdInfos(valid.reduce((acc: Record<string, any>, i) => { acc[i.id] = i.adInfo; return acc }, {}))
          // Mark all as tracked
          setTrackedAds(valid.reduce((acc: Record<string, number|null>, i) => { acc[i.id] = days ?? null; return acc }, {}))
          setStatusMessage('Done - All results auto-tracked')
        } finally {
          setImageLoading(false)
        }
      }
    } catch (err: any) {
      console.error('Upload error', err)
      setError(err?.message || 'Upload or server error')
      setStatusMessage(`Failed: ${err?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
      setIsUploading(false)
      xhrRef.current = null
      // clear status after a short delay to avoid UI getting stuck
      setTimeout(() => setStatusMessage(null), 3000)
    }
  }

  const clear = () => {
    setFile(null)
    setFileThumbnail(null)
    setResults(null)
    setImageItems(null)
    setAdInfos(null)
    setActiveAdId(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Debounced search: triggers 500ms after the last keystroke
  React.useEffect(() => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setSearchResults(null)
      return
    }
    const t = setTimeout(() => {
      doSearch()
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Track concurrent search requests so we keep the loading indicator active
  const hideSpinnerTimeoutRef = useRef<number | null>(null)
  const startSearchRequest = () => {
    // Cancel any pending hide timeout so spinner stays visible
    if (hideSpinnerTimeoutRef.current) {
      clearTimeout(hideSpinnerTimeoutRef.current)
      hideSpinnerTimeoutRef.current = null
    }
    inFlightSearches.current = (inFlightSearches.current || 0) + 1
    setSearchLoading(true)
  }
  const endSearchRequest = () => {
    inFlightSearches.current = Math.max(0, (inFlightSearches.current || 0) - 1)
    if (inFlightSearches.current === 0) {
      // Small delay to avoid flicker for very short requests
      hideSpinnerTimeoutRef.current = window.setTimeout(() => {
        setSearchLoading(false)
        hideSpinnerTimeoutRef.current = null
      }, 150)
    }
  }

  // Clean up timeout and any pending brand search on unmount
  React.useEffect(() => {
    return () => {
      if (hideSpinnerTimeoutRef.current) {
        clearTimeout(hideSpinnerTimeoutRef.current)
        hideSpinnerTimeoutRef.current = null
      }
      if (brandSearchAbortRef.current) {
        brandSearchAbortRef.current.abort()
        brandSearchAbortRef.current = null
      }
    }
  }, [])

  const updateDropdownWidth = () => {
    const inp = brandInputRef.current as HTMLInputElement | null
    if (!inp) return
    const inpRect = inp.getBoundingClientRect()
    const container = containerRef.current as HTMLDivElement | null
    if (container) {
      const contRect = container.getBoundingClientRect()
      setDropdownWidth(Math.round(inpRect.width))
      setDropdownLeft(Math.round(inpRect.left - contRect.left))
      return
    }
    setDropdownWidth(Math.round(inpRect.width))
    setDropdownLeft(null)
  }

  React.useEffect(() => {
    const onResizeOrScroll = () => updateDropdownWidth()
    window.addEventListener('resize', onResizeOrScroll)
    window.addEventListener('scroll', onResizeOrScroll, { passive: true })
    return () => {
      window.removeEventListener('resize', onResizeOrScroll)
      window.removeEventListener('scroll', onResizeOrScroll)
    }
  }, [])

  const doSearch = async () => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setSearchResults(null)
      return
    }

    const query = searchQuery.trim()
    const cacheKey = query.toLowerCase()

    // Cancel any prior in-flight search to avoid unnecessary state churn
    if (brandSearchAbortRef.current) {
      brandSearchAbortRef.current.abort()
      brandSearchAbortRef.current = null
    }
    const ac = new AbortController()
    brandSearchAbortRef.current = ac

    // Mark this search with a unique id so we can ignore stale responses
    latestSearchIdRef.current = (latestSearchIdRef.current || 0) + 1
    const requestId = latestSearchIdRef.current

    // Clear any prior transient error for a cleaner UX
    setError(null)
    startSearchRequest()
    setSearchResults(null)

    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`, { signal: ac.signal })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt)
      }
      const json = await res.json()

      // Robustly find an array of candidate results in several possible response shapes
      function findResults(obj: any): any[] {
        if (!obj) return []
        const candidates = [
          obj,
          obj.searchResults,
          obj.items,
          obj.results,
          obj.response && obj.response.body && obj.response.body.items,
          obj.data,
          obj.results && Array.isArray(obj.results) ? obj.results : undefined,
        ]
        for (const c of candidates) {
          if (Array.isArray(c) && c.length > 0) return c
        }
        // search one level deep
        for (const k of Object.keys(obj || {})) {
          const v = obj[k]
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') return v
        }
        return []
      }

      const resultsArray = findResults(json)

      // If this response is stale (a newer search was started), ignore it
      if (requestId !== latestSearchIdRef.current) return

      if (!resultsArray || resultsArray.length === 0) {
        // If we have cached successful results for this normalized query, reuse them to avoid a brief "No brands found" flash
        const cached = searchCacheRef.current.get(cacheKey)
        if (cached && cached.length > 0) {
          if (requestId === latestSearchIdRef.current) {
            setSearchResults(cached)
            setError(null)
            setTimeout(updateDropdownWidth, 0)
          }
        } else {
          if (requestId === latestSearchIdRef.current) setSearchResults([])
        }
        return
      }

      const mapped = resultsArray.map(i => ({
        page_id: String(i.page_id ?? i.id ?? i.pageId ?? ''),
        name: i.name ?? i.page_name ?? i.title ?? i.page_alias ?? '',
        image_uri: i.image_uri ?? i.image ?? i.image_uri ?? i.thumbnail_url ?? '',
        ig_username: i.ig_username ?? i.instagram ?? i.ig_username ?? null,
        category: i.category ?? ''
      }))

      // Cache successful non-empty results for this normalized query
      searchCacheRef.current.set(cacheKey, mapped)

      // Double-check still the latest before updating UI
      if (requestId === latestSearchIdRef.current) {
        setSearchResults(mapped)
        setError(null)
        setTimeout(updateDropdownWidth, 0)
      }
    } catch (e: any) {
      // Abort cancellations are expected when a newer search starts — ignore silently
      if (e && (e.name === 'AbortError' || e?.message?.toLowerCase?.().includes('aborted'))) {
        return
      }

      console.error('Search failed', e)
      // Only set visible error if this request is still the latest
      if (requestId === latestSearchIdRef.current) {
        const cached = searchCacheRef.current.get(cacheKey)
        if (cached && cached.length > 0) {
          setSearchResults(cached)
          setError(null)
          setTimeout(updateDropdownWidth, 0)
        } else {
          setError('Brand search failed — try again')
          setSearchResults([])
        }
      }
    } finally {
      endSearchRequest()
    }
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

  // Fetch tracker ads for the current user
  const fetchTrackedAds = async () => {
    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch('/api/tracker-ads', { headers })
      if (!res.ok) return
      const json = await res.json()
      const ads = json.ads ?? {}
      setTrackedAds(Object.keys(ads).reduce((acc: Record<string,number|null>, k: string) => { acc[k] = ads[k]?.days ?? null; return acc }, {}))
    } catch (e) {
      console.warn('Failed to fetch tracker ads', e)
    }
  }

  // Toggle tracked state for a given ad id
  const toggleTrackAd = async (adId: string, adInfo: any = null) => {
    // Start a short delayed spinner to avoid flicker on fast responses
    if (!trackedLoadingTimeoutRef.current[adId]) {
      trackedLoadingTimeoutRef.current[adId] = window.setTimeout(() => {
        setTrackedLoading(prev => ({ ...prev, [adId]: true }))
        trackedLoadingTimeoutRef.current[adId] = null
      }, 200)
    }

    try {
      const tokenModule = await import('../lib/firebaseClient')
      const token = await tokenModule.getIdToken()
      const headers: Record<string,string> = { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

      // Extract ad URL if available (store only URL server-side)
      const adUrl = String(adInfo?.snapshot?.link_url ?? adInfo?.url ?? adInfo?.snapshot?.linkUrl ?? '') || null

      if (trackedAds[adId]) {
        // Retrack: re-POST to update the tracked ad data
        const res = await fetch('/api/tracker-ads', { method: 'POST', headers, body: JSON.stringify({ adId, adUrl, adDays: days }) })
        if (!res.ok) throw new Error(await res.text())
        setTrackedAds(prev => ({ ...prev, [adId]: days ?? null }))
      } else {
        const res = await fetch('/api/tracker-ads', { method: 'POST', headers, body: JSON.stringify({ adId, adUrl, adDays: days }) })
        if (!res.ok) throw new Error(await res.text())
        setTrackedAds(prev => ({ ...prev, [adId]: days ?? null }))
      }
    } catch (e: any) {
      console.error('Tracking action failed', e)
      setError(String(e?.message ?? e))
      setTimeout(() => setError(null), 4000)
    } finally {
      // Clean up delayed spinner timeout (if it hasn't fired yet)
      const t = trackedLoadingTimeoutRef.current[adId]
      if (t) {
        clearTimeout(t)
        trackedLoadingTimeoutRef.current[adId] = null
      }
      // If the spinner was shown, hide it now
      setTrackedLoading(prev => { const c = { ...prev }; delete c[adId]; return c })
    }
  }

  // Fetch latest ad info live and show modal
  const fetchAndOpenAd = async (adId: string) => {
    if (!adId) return
    setFetchingAdId(adId)
    try {
      const res = await fetch(`/api/ad/${encodeURIComponent(adId)}`)
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const adInfo = json?.adInfo ?? null
      setAdInfos(prev => ({ ...(prev || {}), [adId]: adInfo }))
      setActiveAdId(adId)
    } catch (e: any) {
      console.error('Failed to fetch ad info', e)
      setError(String(e?.message ?? e))
      setTimeout(() => setError(null), 4000)
    } finally {
      setFetchingAdId(null)
    }
  }

  // Load tracked ads on mount
  React.useEffect(() => { fetchTrackedAds() }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 mt-8">
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Upload Video to Track Ad Usage</h1>
          <p className="text-sm text-gray-500 mt-2">Upload the original video you shared with the brand. We'll scan active ads to see if it's being used.</p>
        </div>

        <form className="mt-4" onSubmit={submit}>
              {/* Large drag-and-drop upload area (click or drop files) */}
              <label className="block text-sm font-medium">Video File</label>
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={onDropClick}
                role="button"
                tabIndex={0}
                className={`mt-4 border-2 ${dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300'} border-dashed rounded-xl py-16 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-300`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onDropClick() }}
              >
                <svg className="h-20 w-20 text-indigo-600" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 477.075 477.075" fill="currentColor" aria-hidden="true">
                  <g></g>
                  <g></g>
                  <g>
                    <g>
                      <g>
                        <path d="M358.387,159.975h-38.9c-7.5,0-13.5,6-13.5,13.5s6,13.5,13.5,13.5h38.9c19.1,0,34.7,15.6,34.7,34.7v193.8 c0,19.1-15.6,34.7-34.7,34.7h-239.8c-19.1,0-34.7-15.6-34.7-34.7v-193.9c0-19.1,15.6-34.7,34.7-34.7h38.9c7.5,0,13.5-6,13.5-13.5 s-6-13.5-13.5-13.5h-38.9c-34,0-61.7,27.7-61.7,61.7v193.8c0,34,27.7,61.7,61.7,61.7h239.9c34,0,61.7-27.7,61.7-61.7v-193.8 C420.087,187.575,392.387,159.975,358.387,159.975z" />
                        <path d="M166.987,104.175l58-58v218c0,7.5,6,13.5,13.5,13.5s13.5-6,13.5-13.5v-218l58,58c2.6,2.6,6.1,4,9.5,4s6.9-1.3,9.5-4 c5.3-5.3,5.3-13.8,0-19.1l-81.1-81.1c-5.3-5.3-13.8-5.3-19.1,0l-81.1,81.1c-5.3,5.3-5.3,13.8,0,19.1 C153.187,109.475,161.687,109.475,166.987,104.175z" />
                      </g>
                    </g>
                  </g>
                </svg>
                <div className="text-lg text-gray-700 mt-3">Drag &amp; drop your video here or click to browse</div>
                <div className="text-sm text-gray-400 mt-1">MP4, MOV · Max 500MB</div>
                <input ref={fileInputRef} type="file" accept="video/*" onChange={onFileChange} className="hidden" />
              </div> 

              {file && (
                <div className="mt-3 flex items-center gap-3">
                  {fileThumbnail ? (
                    <img src={fileThumbnail} alt={file.name} className="w-28 h-20 rounded object-cover border" />
                  ) : (
                    <div className="w-28 h-20 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500">Generating thumbnail…</div>
                  )}
                  <div className="text-sm text-gray-700">Selected: <strong className="block">{file.name}</strong></div>
                  <button type="button" onClick={() => { clear() }} className="text-sm text-red-500 hover:underline ml-auto">Remove</button>
                </div>
              )}

              {/* Brand selection (required) */}
              <label className="block text-sm font-medium mt-6">Brand name <span className="text-red-500">*</span></label>
              <div ref={containerRef} className="mt-2 relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                  <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
                </span>
                <input ref={brandInputRef} type="text" value={String((searchQuery ?? ''))} onChange={e => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch() } }} onFocus={() => { if (searchQuery && searchQuery.trim().length > 0) doSearch(); setKeepDropdownOpen(true); setTimeout(updateDropdownWidth, 0) }} onBlur={() => setTimeout(() => { if (!keepDropdownOpen) setSearchResults(null); setKeepDropdownOpen(false) }, 150)} className="w-full rounded-md border-gray-200 shadow-sm p-3 text-sm pl-10 focus:ring-2 focus:ring-indigo-200" placeholder="Brand name" />

                {searchResults !== null && (
                  <div ref={dropdownRef} style={ dropdownWidth !== null ? { width: `${dropdownWidth}px`, left: dropdownLeft !== null ? `${dropdownLeft}px` : undefined } : undefined } className="absolute z-50 mt-1 left-0 bg-white border rounded shadow-sm max-h-64 overflow-auto">
                    {searchLoading ? (
                      <div className="p-3 text-sm text-gray-500 flex items-center gap-2"><span className="inline-flex items-center"><svg className="h-4 w-4 animate-spin text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg></span> Searching…</div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map(r => (
                        <div key={r.page_id} className={`p-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 ${pageId === r.page_id ? 'bg-indigo-50' : ''}`} onMouseDown={(ev) => ev.preventDefault()} onClick={() => { setPageId(r.page_id); setSelectedBrand(r); setSearchResults(null); setKeepDropdownOpen(false); brandInputRef.current?.blur(); }}>
                          <img src={r.image_uri} alt={r.name} className="w-10 h-10 rounded object-cover" />
                          <div className="flex-1">
                            <div className="text-sm font-medium">{r.name}</div>
                            <div className="text-xs text-gray-500">{r.ig_username ? `@${r.ig_username}` : ''}</div>
                          </div>
                          <div className="text-xs text-gray-500">{r.category}</div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-sm text-gray-500">No brands found</div>
                    )}
                  </div>
                )}
              </div>
              {searchLoading && <div className="text-xs text-gray-500 mt-2 flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Searching…</div>}
              {selectedBrand && (
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <img src={selectedBrand.image_uri} className="w-8 h-8 rounded object-cover" />
                  <div>
                    <div className="font-medium">{selectedBrand.name}</div>
                    <div className="text-xs text-gray-500">{selectedBrand.ig_username ? `@${selectedBrand.ig_username}` : ''}</div>
                  </div>
                  <button type="button" onClick={() => { setSelectedBrand(null); setPageId('') }} className="text-sm text-red-500 ml-auto">Remove</button>
                </div>
              )}

              {/* Days input: ad rights duration used for comparison */}
              <div className="mt-3">
                <label className="block text-sm font-medium">Ad rights duration (days)</label>
                <div className="mt-2">
                  <input
                    type="number"
                    min={1}
                    value={days}
                    onChange={(e) => setDays(parseInt(e.target.value || '0', 10))}
                    className="w-28 rounded-md border-gray-200 shadow-sm p-2 text-sm"
                    aria-label="Ad rights duration in days"
                  />
                </div>
              </div>

              <div className="mt-3 bg-gray-100 border border-gray-200 rounded-md p-3 text-sm text-gray-700 flex items-center gap-2">
                <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>
                <div>Adding a brand improves detection accuracy.</div>
              </div>

          {error && (
            <div className="mt-3 text-sm text-red-600">Error: {error}</div>
          )}


          <div className="mt-6 flex items-center gap-4">
            <button type="submit" disabled={loading || !pageId || !file} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-8 py-3 rounded-full font-semibold text-lg">
              {loading ? (<div className="flex items-center gap-2"><Spinner className="h-4 w-4 text-white" /> Uploading…</div>) : 'Upload & Scan Ads'}
            </button>
            <button type="button" onClick={() => { setFile(null); setResults(null); setImageItems(null); setAdInfos(null); setActiveAdId(null); setError(null); setPageId(''); setSelectedBrand(null); setSearchQuery(''); setSearchResults(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="border border-gray-200 px-6 py-3 rounded-full text-sm">Reset</button>
          </div>
          {statusMessage && (
            <div className="mt-3 text-sm text-gray-600" role="status" aria-live="polite">{statusMessage}</div>
          )}
        </form>

        {results && results.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-medium">Results (Preview Images)</h3>
            {imageLoading && <div className="text-sm text-gray-500 mt-2 flex items-center gap-2"><Spinner className="h-4 w-4 text-gray-500" /> Loading preview images…</div>}
            {imageItems && imageItems.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {imageItems.map((it, i) => (
                  <div key={`${it.id}-${i}`} className="relative">
                    <button onClick={() => fetchAndOpenAd(it.id)} className="p-0 m-0 border-0 bg-transparent w-full">
                      <img src={it.src} alt={`Ad preview ${i + 1}`} className="w-full h-48 object-cover rounded-md shadow-sm cursor-pointer" />
                    </button>

                    {fetchingAdId === it.id ? (
                      <div className="absolute inset-0 bg-black bg-opacity-30 rounded-md flex items-center justify-center">
                        <Spinner className="h-6 w-6 text-white" />
                      </div>
                    ) : null}

                    <button
                      onClick={() => toggleTrackAd(it.id, adInfos?.[it.id] ?? null)}
                      disabled={!!trackedLoading[it.id]}
                      className={`absolute top-2 right-2 text-xs px-2 py-1 rounded ${trackedAds[it.id] ? 'bg-indigo-700 text-white' : 'bg-white text-gray-700 border'} ${trackedLoading[it.id] ? 'opacity-80 cursor-wait' : ''}`}>
                      {trackedLoading[it.id] ? (
                        <span className="inline-flex items-center gap-1">
                          <Spinner className={`${trackedAds[it.id] ? 'h-3 w-3 text-white' : 'h-3 w-3 text-gray-700'}`} />
                          {trackedAds[it.id] ? 'Retracking…' : 'Tracking…'}
                        </span>
                      ) : (
                        trackedAds[it.id] ? 'Retrack' : 'Track'
                      )}
                    </button>

                  </div>
                ))}
              </div>
            ) : imageItems && imageItems.length === 0 ? (
              <div className="mt-2 text-sm text-gray-500">No preview images found for results under threshold.</div>
            ) : null}

            {activeAdId && adInfos && adInfos[activeAdId] ? (
              <AdModal adInfo={adInfos[activeAdId]} onClose={() => setActiveAdId(null)} adId={activeAdId} rightsDays={days} />
            ) : null}
          </section>
        )}
      </div>
    </div>
  )
}
