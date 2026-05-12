import { NextResponse } from 'next/server'

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

export async function POST(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const { Firestore } = await import('@google-cloud/firestore')
    const projectId = process.env.FIRESTORE_PROJECT_ID

    let firestore: any
    if (process.env.NEXT_SA_KEY) {
      try {
        const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
        firestore = new Firestore({ projectId: projectId || creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key }, preferRest: true })
      } catch (e) {
        firestore = new Firestore({ projectId, preferRest: true })
      }
    } else {
      firestore = new Firestore({ projectId, preferRest: true })
    }

    // Auth check
    let uid: string
    try {
      uid = await (await import('../../../../../lib/firebaseAdmin')).getUidFromAuthHeader(request.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await (context.params as any)
    const id = resolvedParams?.id
    if (!id) return NextResponse.json({ message: 'Missing id' }, { status: 400 })

    const col = process.env.FIRESTORE_COLLECTION || 'queries'
    const docRef = firestore.collection(col).doc(id)
    const doc = await docRef.get()
    if (!doc.exists) return NextResponse.json({ message: 'Not found' }, { status: 404 })
    const data = doc.data() as any

    if (data?.uid !== uid) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const thumb = data?.response?.thumbnail_url || data?.thumbnail_url
    if (!thumb) return NextResponse.json({ message: 'No thumbnail' }, { status: 404 })

    if (typeof thumb === 'string' && (thumb.startsWith('data:') || thumb.startsWith('http'))) {
      return NextResponse.json({ message: 'Already normalized', thumbnail: thumb })
    }

    const match = /(?:gs:\/\/)?([^\/]+)\/(.+)/.exec(thumb)
    if (!match) return NextResponse.json({ message: 'Invalid thumbnail path' }, { status: 400 })
    const bucket = match[1]
    const name = match[2]

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

    // Update both top-level and response.thumbnail_url when present
    const update: any = { thumbnail_url: dataUrl }
    if (data?.response) update['response.thumbnail_url'] = dataUrl

    await docRef.update(update)

    return NextResponse.json({ message: 'Normalized', thumbnail: dataUrl })
  } catch (err: any) {
    console.error('Error normalizing thumbnail', err)
    return NextResponse.json({ message: 'Error', details: err?.message || String(err) }, { status: 500 })
  }
}
