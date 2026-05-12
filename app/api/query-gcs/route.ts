import { NextResponse } from 'next/server'
import { queryAdWithGcs } from '../../actions/queryAd'
import { getIdTokenClient } from '../../../lib/getIdToken'
// Lazy-load heavy GCP clients inside the handler to avoid executing their
// module initialization (which may enumerate getters) at build time.
let storage: any
let firestore: any

function normalizeServiceAccount(raw: string) {
  let creds: any
  try {
    creds = JSON.parse(raw)
  } catch {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    creds = JSON.parse(decoded)
  }
  if (creds.private_key && typeof creds.private_key === 'string') {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n')
  }
  return creds
}

async function createStorageClient() {
  const { Storage } = await import('@google-cloud/storage')

  if (!process.env.NEXT_SA_KEY) {
    return new Storage()
  }

  try {
    const credentials = normalizeServiceAccount(process.env.NEXT_SA_KEY)
    return new Storage({ credentials })
  } catch (err) {
    console.warn('NEXT_SA_KEY provided but failed to parse; falling back to ADC')
    return new Storage()
  }
}

export async function POST(req: Request) {
  try {
    const { Firestore } = await import('@google-cloud/firestore')
    // Init clients lazily
    if (!firestore) {
      if (process.env.NEXT_SA_KEY) {
        try {
          const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
          firestore = new Firestore({ projectId: creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key }, preferRest: true })
        } catch (err) {
          console.warn('NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
          firestore = new Firestore({ preferRest: true })
        }
      } else {
        firestore = new Firestore({ preferRest: true })
      }
    }
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

    try {
      
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

      // Log the complete raw response from GCP API
      console.log('=== GCP QUERY API RAW RESPONSE ===')
      console.log(JSON.stringify(res, null, 2))
      console.log('=== END GCP RESPONSE ===')

      // Optional delete is disabled here to avoid Storage SDK usage on Vercel.

      let out = brandRegistration ? { ...res, brandRegistration } : res

      // GCP API already creates the query document with query_id
      // We don't need to create or update anything here
      // The document will be updated later with user metadata when needed

      // If Cloud Run produced a thumbnail as a gs:// path, convert it to a
      // data URL and update the Firestore doc so the UI can render it like
      // direct uploads do (which supply a data: URL from the client).
      try {
        const queryId = (out as any)?.query_id
        if (queryId) {
          const col = process.env.FIRESTORE_COLLECTION || 'queries'
          const docRef = firestore.collection(col).doc(queryId)
          const docSnap = await docRef.get()
          if (docSnap.exists) {
            const docData = docSnap.data() as any
            const thumb = docData?.response?.thumbnail_url || docData?.thumbnail_url
            if (typeof thumb === 'string' && thumb.startsWith('gs://')) {
              try {
                const m = /(?:gs:\/\/)?([^\/]+)\/(.+)/.exec(thumb)
                if (m) {
                  const bucket = m[1]
                  const name = m[2]
                  const storage = await createStorageClient()
                  const file = storage.bucket(bucket).file(name)
                  const [contents] = await file.download()
                  let contentType = 'image/jpeg'
                  try {
                    const [meta] = await file.getMetadata()
                    if (meta && meta.contentType) contentType = meta.contentType
                  } catch (e) {
                    // ignore
                  }
                  const base64 = contents.toString('base64')
                  const dataUrl = `data:${contentType};base64,${base64}`
                  const update: any = { thumbnail_url: dataUrl }
                  if (docData?.response) update['response.thumbnail_url'] = dataUrl
                  await docRef.update(update)
                  // reflect normalized thumbnail in the outgoing response
                  out = { ...(out as any), normalized_thumbnail: dataUrl }
                }
              } catch (normErr) {
                console.warn('Failed to normalize thumbnail for query', queryId, normErr)
              }
            }
          }
        }
      } catch (e) {
        console.warn('Thumbnail normalization step failed:', e)
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
