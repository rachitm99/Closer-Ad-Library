import { NextResponse } from 'next/server'
import { queryAdWithGcs } from '../../actions/queryAd'
import { getIdTokenClient } from '../../../lib/getIdToken'
import { Storage } from '@google-cloud/storage'

// Storage client: support NEXT_SA_KEY fallback (useful for deployments without ADC)
let storage: Storage
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    storage = new Storage({ credentials: creds })
  } catch (err) {
    console.warn('NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    storage = new Storage()
  }
} else {
  storage = new Storage()
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const gcsPath = body?.gcsPath
    const pageId = body?.pageId
    if (!gcsPath) return NextResponse.json({ message: 'Missing gcsPath' }, { status: 400 })

    // Parse gcsPath: expect format gs://bucket/path/to/object
    const match = /(?:gs:\/\/)?([^\/]+)\/(.+)/.exec(gcsPath)
    if (!match) return NextResponse.json({ message: 'Invalid gcsPath format' }, { status: 400 })
    const bucketName = match[1]
    const objectName = match[2]

    // Enforce MAX_FILE_BYTES (default 500MB)
    const maxBytes = parseInt(process.env.MAX_FILE_BYTES || '500000000', 10)
    try {
      const file = storage.bucket(bucketName).file(objectName)
      const [meta] = await file.getMetadata()
      const size = Number(meta.size || 0)
      if (size > maxBytes) return NextResponse.json({ message: `File too large. Max is ${maxBytes} bytes` }, { status: 413 })
      // If a brand was selected client-side, forward it to the search service /brands endpoint
      const brand = body?.brand
      let brandRegistration: any = null
      if (brand && (brand.name || brand.page_id)) {
        try {
          const searchUrl = process.env.CLOUD_RUN_SEARCH_URL || 'https://face-query-service-810614481902.us-central1.run.app/search'
          const brandsUrl = searchUrl.replace(/\/search$/, '') + '/brands'
          const audience = new URL(brandsUrl).origin
          const client = await getIdTokenClient(audience)
          const regRes = await client.request({ url: brandsUrl, method: 'POST', data: brand } as any)
          brandRegistration = { status: regRes?.status, body: regRes?.data }
        } catch (e: any) {
          console.warn('Failed to register brand with search service', e?.message || String(e))
          brandRegistration = { error: String(e?.message || e), response: e?.response?.data ?? null }
        }
      }
      const res = await queryAdWithGcs(gcsPath, pageId)

      // Optionally delete the uploaded object after successful processing
      if (process.env.DELETE_GCS_AFTER_DOWNLOAD === 'true') {
        try {
          await file.delete()
        } catch (delErr: any) {
          console.warn('Failed to delete GCS object after processing:', delErr?.message || String(delErr))
        }
      }

      // Attach brandRegistration info if present so the client can surface it
      const out = brandRegistration ? { ...res, brandRegistration } : res
      return NextResponse.json(out)
    } catch (err: any) {
      console.error('Error while validating or deleting GCS object', err)
      return NextResponse.json({ message: 'Error validating GCS object', details: err?.message || String(err) }, { status: 500 })
    }
  } catch (err: any) {
    console.error('Error in /api/query-gcs', err)
    return NextResponse.json({ message: 'Server error', details: err?.message || String(err) }, { status: 500 })
  }
}
