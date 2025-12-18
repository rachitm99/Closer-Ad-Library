export type NormalizedResult = {
  id: string
  url?: string
  total_distance?: number
  avg_similarity?: number
  max_similarity?: number
  matches_count?: number
}

/**
 * Normalize various Cloud Run result shapes to a common structure used by the UI.
 * Supports both legacy { video_id, avg_similarity, ... } and new { ad_id, total_distance, ... } shapes.
 */
export function normalizeCloudRunResults(raw: any): NormalizedResult[] {
  if (!raw) return []

  // Helper: determine candidate results array in several possible locations
  function findResults(obj: any): any[] {
    if (!obj) return []
    const candidates = [
      obj.results,
      obj.results_full,
      obj.response && obj.response.results,
      obj.response && obj.response.results_full,
      obj.response && obj.response.results_full && obj.response.results_full[0] && obj.response.results_full[0].results,
      obj.results_full && Array.isArray(obj.results_full) ? obj.results_full.flatMap((x: any) => (Array.isArray(x) ? x : [x])) : undefined,
    ]
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c
    }

    // Fallback: search one level deep for the first array of objects that looks like results
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') return v
    }
    return []
  }

  const resultsArray = findResults(raw)
  if (!Array.isArray(resultsArray) || resultsArray.length === 0) return []

  return resultsArray.map((r: any) => {
    if (r == null) return null as any
    // New shape: ad_id, ad_url, total_distance
    if (typeof r.ad_id === 'string' || typeof r.ad_url === 'string' || typeof r.total_distance === 'number') {
      return {
        id: String(r.ad_id ?? r.video_id ?? r.id ?? 'unknown'),
        url: r.ad_url ?? r.adUrl ?? r.video_url ?? undefined,
        total_distance: typeof r.total_distance === 'number' ? r.total_distance : undefined,
        avg_similarity: typeof r.avg_similarity === 'number' ? r.avg_similarity : undefined,
        max_similarity: typeof r.max_similarity === 'number' ? r.max_similarity : undefined,
        matches_count: typeof r.matches_count === 'number' ? r.matches_count : undefined,
      }
    }

    // Legacy shape: video_id, avg_similarity, etc.
    if (typeof r.video_id === 'string') {
      return {
        id: String(r.video_id),
        url: r.ad_url ?? (r as any).adUrl ?? undefined,
        avg_similarity: typeof r.avg_similarity === 'number' ? r.avg_similarity : undefined,
        max_similarity: typeof r.max_similarity === 'number' ? r.max_similarity : undefined,
        matches_count: typeof r.matches_count === 'number' ? r.matches_count : undefined,
      }
    }

    // Fallback: attempt to extract some fields
    return {
      id: String(r.id ?? r.video_id ?? r.ad_id ?? 'unknown'),
      url: r.url ?? r.ad_url ?? undefined,
    }
  }).filter(Boolean)
}
