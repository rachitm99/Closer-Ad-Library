# Migration to Queries Collection Architecture

## Overview
Migrated from the custom `tracked_ads` collection to the existing `queries` collection for better alignment with the existing Firestore structure. The queries collection already stores GCP query results and metadata, so we've added tracked ad management to this structure.

## Key Changes

### 1. Updated Query Storage (query-gcs/route.ts)
- Now extracts `query_id` from GCP response (if available)
- Uses query_id as Firestore document ID, or generates one if not provided
- Returns query_id in response for client-side tracking
- Initializes `tracked_ads` array in query document

### 2. New API Routes

#### `/api/queries/[queryId]/track` (POST/PATCH)
- **POST**: Adds a new tracked ad to a query's subcollection
  - Stores ad in `queries/{queryId}/tracked_ads/{adId}` subcollection
  - Also adds adId to `tracked_ads` array in parent document
  - Fields: adId, adInfo, preview, isEmpty, addedAt, lastFetched, liveAdInfo

- **PATCH**: Updates live ad info for refresh functionality
  - Updates liveAdInfo and lastFetched timestamp

#### `/api/queries/[queryId]` (GET/DELETE)
- **GET**: Returns specific query with all tracked ads from subcollection
- **DELETE**: Deletes query and all tracked ads in subcollection (batch delete)

#### `/api/queries` (GET - updated)
- Returns all queries for authenticated user
- Now includes tracked ads from subcollections
- Ordered by last_queried descending

### 3. Updated VideoQuery Component
- Extracts query_id from GCP response (required)
- Uses query_id for tracking instead of generating one
- Calls new `/api/queries/{queryId}/track` endpoint
- Removed unnecessary fields (pageId, days, queryThumbnail, phashes) from tracking call since they're in parent query document

### 4. Updated TrackerAds Component  
- Reads from `/api/queries` instead of `/api/tracker-ads`
- Converts queries collection format to QueryGroup format
- Uses new delete endpoint: `DELETE /api/queries/{queryId}`
- Uses new refresh endpoint: `PATCH /api/queries/{queryId}/track`

### 5. Updated Tracker Detail Page
- Fetches specific query: `GET /api/queries/{queryId}`
- Extracts tracked ads from subcollection
- Gets phashes from `query.response.phashes` or `query.response.query_phashes`
- Uses new track endpoint for refresh functionality
- Fetches full ad data before tracking new matches

## Data Structure

### Queries Collection Document
```typescript
{
  uid: string
  page_id: string
  days: number
  response: {
    results: [
      {
        ad_id: string
        ad_url: string
        total_distance: number
        ref_phashes: string  // Per-ad phashes
        positional_distances: number[]
      }
    ],
    phashes: string  // Query phashes
    query_phashes: string  // Alternative location
  }
  thumbnail_url: string | null
  uploaded_video: string
  last_queried: string (ISO timestamp)
  tracked_ads: string[]  // Array of ad IDs for quick reference
}
```

### Tracked Ads Subcollection (queries/{queryId}/tracked_ads/{adId})
```typescript
{
  adId: string
  adInfo: object | null  // Initial ad data
  preview: string | null  // Preview image URL
  isEmpty: boolean  // True for empty placeholder
  addedAt: string (ISO timestamp)
  lastFetched: string | null  // Last refresh timestamp
  liveAdInfo: object | null  // Updated ad data from refresh
}
```

## Benefits

1. **Better Data Organization**: Query metadata and tracked ads are now logically grouped
2. **Reduced Redundancy**: No need to store pageId, days, phashes with each ad
3. **Cleaner Architecture**: Leverages existing queries collection structure
4. **Efficient Queries**: Can fetch query with all tracked ads in single request
5. **Flexible IDs**: Uses GCP query_id when available, generates fallback otherwise

## Migration Notes

- Old `tracked_ads` collection data will remain but won't be used
- New queries will automatically use the new structure
- Phashes are now read from `query.response` object instead of being stored per-ad
- Query thumbnail stored in `query.thumbnail_url` field (currently null, can be updated later)

## Testing Checklist

- [x] Upload video and create query
- [ ] Verify query stored with correct structure
- [ ] Check tracked ads stored in subcollection
- [ ] Confirm tracker page displays queries correctly
- [ ] Test query detail page loads
- [ ] Test refresh functionality (requires phashes from GCP)
- [ ] Test delete query functionality
- [ ] Verify empty queries (no matches) handled correctly
- [ ] Check live data refresh updates liveAdInfo
