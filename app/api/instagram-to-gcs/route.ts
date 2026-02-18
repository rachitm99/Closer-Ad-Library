import { NextResponse } from 'next/server'
import { extractShortcodeFromUrl } from '../../../utils/extractShortcode'
import { Storage } from '@google-cloud/storage'
import * as crypto from 'crypto'

const ROCKETAPI_KEY = process.env.ROCKET_API_TOKEN
const ROCKETAPI_BASE = 'https://v1.rocketapi.io/instagram/media'

// Initialize Storage client
let storageClient: Storage | null = null
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    storageClient = new Storage({ credentials: creds })
  } catch (err) {
    console.warn('[instagram-to-gcs] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
  }
}
if (!storageClient) {
  storageClient = new Storage()
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { instagramUrl } = body

    if (!instagramUrl) {
      return NextResponse.json({ error: 'Instagram URL is required' }, { status: 400 })
    }

    console.log('[instagram-to-gcs] Processing Instagram URL:', instagramUrl)

    // Check if API token is configured
    if (!ROCKETAPI_KEY) {
      console.error('[instagram-to-gcs] ROCKET_API_TOKEN not found in environment')
      return NextResponse.json({ error: 'Instagram API not configured. Please contact support.' }, { status: 500 })
    }
    console.log('[instagram-to-gcs] API token available:', !!ROCKETAPI_KEY)

    // Step 1: Extract shortcode from URL
    const shortcode = extractShortcodeFromUrl(instagramUrl)
    if (!shortcode) {
      return NextResponse.json({ error: 'Could not extract shortcode from URL' }, { status: 400 })
    }

    console.log('[instagram-to-gcs] Extracted shortcode:', shortcode)

    // Step 2: Get media ID by shortcode
    console.log('[instagram-to-gcs] Fetching media ID...')
    const idResponse = await fetch(`${ROCKETAPI_BASE}/get_id_by_shortcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${ROCKETAPI_KEY}`
      },
      body: JSON.stringify({ shortcode })
    })

    if (!idResponse.ok) {
      const errorText = await idResponse.text()
      console.error('[instagram-to-gcs] Failed to get ID. Status:', idResponse.status)
      console.error('[instagram-to-gcs] Error response:', errorText)
      return NextResponse.json(
        { error: 'Failed to get media ID from Instagram', details: errorText },
        { status: idResponse.status }
      )
    }

    const idData = await idResponse.json()
    console.log('[instagram-to-gcs] ID response:', JSON.stringify(idData, null, 2).substring(0, 500))

    if (!idData.id) {
      console.error('[instagram-to-gcs] No ID in response. Response keys:', Object.keys(idData))
      return NextResponse.json({ error: 'No ID returned from RocketAPI', responseKeys: Object.keys(idData) }, { status: 500 })
    }
    
    console.log('[instagram-to-gcs] Got media ID:', idData.id)

    // Step 3: Get media info by shortcode
    console.log('[instagram-to-gcs] Fetching media info...')
    const infoResponse = await fetch(`${ROCKETAPI_BASE}/get_info_by_shortcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${ROCKETAPI_KEY}`
      },
      body: JSON.stringify({ shortcode })
    })

    if (!infoResponse.ok) {
      const errorText = await infoResponse.text()
      console.error('[instagram-to-gcs] Failed to get info:', errorText)
      return NextResponse.json(
        { error: 'Failed to get media info from Instagram', details: errorText },
        { status: infoResponse.status }
      )
    }

    const mediaInfo = await infoResponse.json()
    console.log('[instagram-to-gcs] Got media info successfully')
    console.log('[instagram-to-gcs] Media info structure:', JSON.stringify(mediaInfo, null, 2).substring(0, 1000))

    // Check if RocketAPI returned an error response
    if (mediaInfo.status === 'error' || mediaInfo.message || (mediaInfo.status && !mediaInfo.response)) {
      console.error('[instagram-to-gcs] RocketAPI returned error response:', JSON.stringify(mediaInfo, null, 2))
      return NextResponse.json({
        error: 'Instagram API error',
        details: mediaInfo.message || mediaInfo.error || 'Unknown error from Instagram API',
        apiResponse: mediaInfo
      }, { status: 502 })
    }

    // Step 4: Extract video URL (highest quality)
    // Try different possible response structures
    let items = mediaInfo?.response?.body?.items || 
                mediaInfo?.body?.items || 
                mediaInfo?.items || 
                []
    
    console.log('[instagram-to-gcs] Found items:', items.length)
    
    if (!items.length) {
      console.error('[instagram-to-gcs] No items found. Full response:', JSON.stringify(mediaInfo, null, 2))
      return NextResponse.json({ 
        error: 'No media items found in Instagram response', 
        details: mediaInfo.message || 'Response structure might have changed',
        responseKeys: Object.keys(mediaInfo),
        fullResponse: mediaInfo
      }, { status: 404 })
    }

    const videoVersions = items[0]?.video_versions || []
    console.log('[instagram-to-gcs] Found video versions:', videoVersions.length)
    
    if (!videoVersions.length) {
      console.error('[instagram-to-gcs] No video versions. Item structure:', JSON.stringify(items[0], null, 2).substring(0, 500))
      return NextResponse.json({ error: 'No video versions found in Instagram media' }, { status: 404 })
    }

    // Sort by width * height to get highest quality
    const highestQuality = videoVersions.sort((a: any, b: any) => {
      const aPixels = (a.width || 0) * (a.height || 0)
      const bPixels = (b.width || 0) * (b.height || 0)
      return bPixels - aPixels
    })[0]

    const videoUrl = highestQuality?.url
    if (!videoUrl) {
      return NextResponse.json({ error: 'Could not extract video URL from Instagram media' }, { status: 404 })
    }

    console.log('[instagram-to-gcs] Found highest quality video:', {
      width: highestQuality.width,
      height: highestQuality.height,
      url: videoUrl.substring(0, 100) + '...'
    })

    // Step 5: Download video
    console.log('[instagram-to-gcs] Downloading video...')
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to download video from Instagram' },
        { status: videoResponse.status }
      )
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
    console.log('[instagram-to-gcs] Downloaded video:', videoBuffer.length, 'bytes')

    // Step 6: Upload to GCS
    const bucketName = process.env.UPLOAD_BUCKET
    if (!bucketName) {
      return NextResponse.json({ error: 'UPLOAD_BUCKET not configured' }, { status: 500 })
    }

    const bucket = storageClient!.bucket(bucketName)
    const filename = `instagram-${shortcode}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.mp4`
    const objectPath = `uploads/${filename}`
    const file = bucket.file(objectPath)

    console.log('[instagram-to-gcs] Uploading to GCS:', objectPath)
    await file.save(videoBuffer, {
      contentType: 'video/mp4',
      metadata: {
        metadata: {
          source: 'instagram',
          shortcode: shortcode,
          originalUrl: instagramUrl
        }
      }
    })

    console.log('[instagram-to-gcs] Upload complete')

    // Step 7: Generate thumbnail (optional - extract from media info)
    let thumbnailUrl = null
    const imageVersions = items[0]?.image_versions2?.candidates || []
    if (imageVersions.length > 0) {
      // Get the first/highest quality thumbnail
      thumbnailUrl = imageVersions[0]?.url || null
    }

    // Return gcsPath in gs://bucket/path format for compatibility with query-gcs route
    const gcsPath = `gs://${bucketName}/${objectPath}`

    return NextResponse.json({
      success: true,
      shortcode,
      gcsPath,
      filename,
      videoInfo: {
        width: highestQuality.width,
        height: highestQuality.height,
        duration: items[0]?.video_duration || null
      },
      thumbnailUrl
    })

  } catch (error: any) {
    console.error('[instagram-to-gcs] Error:', error)
    return NextResponse.json(
      { error: 'Server error', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}
