import { NextResponse } from 'next/server'
import { extractShortcodeFromUrl } from '../../../utils/extractShortcode'
import * as fs from 'fs'
import * as path from 'path'

const ROCKETAPI_KEY = 'ZKMBv0r5ALDKoie7Z_5fXw'
const ROCKETAPI_BASE = 'https://v1.rocketapi.io/instagram/media'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: 'Instagram URL is required' }, { status: 400 })
    }

    // Step 1: Extract shortcode from URL
    const shortcode = extractShortcodeFromUrl(url)
    if (!shortcode) {
      return NextResponse.json({ error: 'Could not extract shortcode from URL' }, { status: 400 })
    }

    console.log('[instagram-media] Extracted shortcode:', shortcode)

    // Step 2: Get media ID by shortcode
    console.log('[instagram-media] Fetching media ID...')
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
      console.error('[instagram-media] Failed to get ID:', errorText)
      return NextResponse.json(
        { error: 'Failed to get media ID', details: errorText },
        { status: idResponse.status }
      )
    }

    const idData = await idResponse.json()
    console.log('[instagram-media] Got media ID:', idData.id)

    if (!idData.id) {
      return NextResponse.json({ error: 'No ID returned from RocketAPI' }, { status: 500 })
    }

    // Step 3: Get media info by shortcode
    console.log('[instagram-media] Fetching media info...')
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
      console.error('[instagram-media] Failed to get info:', errorText)
      return NextResponse.json(
        { error: 'Failed to get media info', details: errorText },
        { status: infoResponse.status }
      )
    }

    const mediaInfo = await infoResponse.json()
    console.log('[instagram-media] Got media info successfully')

    // Step 4: Save response to JSON file
    const dataDir = path.join(process.cwd(), 'data')
    const filename = `instagram-media-${shortcode}-${Date.now()}.json`
    const filePath = path.join(dataDir, filename)

    try {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }

      // Write the media info to file
      fs.writeFileSync(filePath, JSON.stringify(mediaInfo, null, 2))
      console.log('[instagram-media] Saved media info to:', filePath)
    } catch (fileError) {
      console.error('[instagram-media] Failed to save file:', fileError)
      // Don't fail the request if file saving fails
    }

    return NextResponse.json({
      success: true,
      shortcode,
      mediaId: idData.id,
      mediaInfo,
      savedTo: filename
    })

  } catch (error: any) {
    console.error('[instagram-media] Error:', error)
    return NextResponse.json(
      { error: 'Server error', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}
