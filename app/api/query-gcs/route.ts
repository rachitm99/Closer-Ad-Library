import { NextResponse } from 'next/server'
import { queryAdWithGcs } from '../../actions/queryAd'
import { getIdTokenClient } from '../../../lib/getIdToken'
import { Storage } from '@google-cloud/storage'
import { Firestore } from '@google-cloud/firestore'

// Storage client: support NEXT_SA_KEY fallback (useful for deployments without ADC)
let storage: Storage
let firestore: Firestore
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    storage = new Storage({ credentials: creds })
    firestore = new Firestore({ projectId: creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
  } catch (err) {
    console.warn('NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    storage = new Storage()
    firestore = new Firestore()
  }
} else {
  storage = new Storage()
  firestore = new Firestore()
}

export async function POST(req: Request) {
  try {
    // require auth via Bearer ID token and get UID
    let uid: string
    try {
      uid = await (await import('../../../lib/firebaseAdmin')).getUidFromAuthHeader(req.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const gcsPath = body?.gcsPath
    const pageId = body?.pageId
    const days = body?.days !== undefined ? parseInt(String(body.days), 10) : undefined
    if (!gcsPath) return NextResponse.json({ message: 'Missing gcsPath' }, { status: 400 })
    if (days !== undefined && (!Number.isInteger(days) || days <= 0)) return NextResponse.json({ message: 'Invalid days parameter' }, { status: 400 })

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
          const searchUrl = process.env.BRAND_FETCHER_URL || process.env.CLOUD_RUN_SEARCH_URL || 'https://brands-face-query-prod-810614481902.us-central1.run.app/search'
          const brandsUrl = searchUrl.replace(/\/search$/, '') + '/brands'
          const audience = process.env.CLOUD_RUN_SEARCH_AUDIENCE || new URL(brandsUrl).origin
          console.info('Using brands audience:', audience)
          const client = await getIdTokenClient(audience)
          const regRes = await client.request({ url: brandsUrl, method: 'POST', data: brand } as any)
          brandRegistration = { status: regRes?.status, body: regRes?.data }
        } catch (e: any) {
          console.warn('Failed to register brand with search service', e?.message || String(e))
          brandRegistration = { error: String(e?.message || e), response: e?.response?.data ?? null }
        }
      }
      // Pass UID to Cloud Run so it can persist the query with owner
      const res = await queryAdWithGcs(gcsPath, pageId, uid, days)

      // Optionally delete the uploaded object after successful processing
      if (process.env.DELETE_GCS_AFTER_DOWNLOAD === 'true') {
        try {
          await file.delete()
        } catch (delErr: any) {
          console.warn('Failed to delete GCS object after processing:', delErr?.message || String(delErr))
        }
      }

      let out = brandRegistration ? { ...res, brandRegistration } : res

      // Persist this query to Firestore for the Queries dashboard (best-effort)
      try {
        const COLLECTION = process.env.FIRESTORE_COLLECTION || 'queries'
        await firestore.collection(COLLECTION).add({
          uid,
          page_id: pageId ?? null,
          days: days ?? null,
          response: res,
          thumbnail_url: null,
          uploaded_video: `${bucketName}/${objectName}`,
          last_queried: new Date().toISOString()
        })
      } catch (persistErr: any) {
        console.warn('Failed to persist query to Firestore:', persistErr?.message || String(persistErr))
      }

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
