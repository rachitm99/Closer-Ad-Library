import { NextResponse } from 'next/server'
import { Firestore } from '@google-cloud/firestore'
import { Storage } from '@google-cloud/storage'

// Firestore client
let firestore: Firestore
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    firestore = new Firestore({ projectId: creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
  } catch (e) {
    firestore = new Firestore()
  }
} else {
  firestore = new Firestore()
}

// Storage client
let storage: Storage
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    storage = new Storage({ credentials: creds })
  } catch (e) {
    storage = new Storage()
  }
} else {
  storage = new Storage()
}

export async function GET(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    let userEmail: string | undefined
    try {
      userEmail = await (await import('../../../../../lib/firebaseAdmin')).getEmailFromAuthHeader(request.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await (context.params as any)
    const id = resolvedParams?.id
    if (!id) return NextResponse.json({ message: 'Missing id' }, { status: 400 })
    const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
    const doc = await docRef.get()
    if (!doc.exists) return NextResponse.json({ message: 'Not found' }, { status: 404 })
    const data = doc.data() as any

    if (data?.owner !== userEmail) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const thumb = data?.response?.thumbnail_url || data?.thumbnail_url
    if (!thumb) return NextResponse.json({ message: 'No thumbnail' }, { status: 404 })

    // thumb expected as gs://bucket/path
    const match = /(?:gs:\/\/)?([^\/]+)\/(.+)/.exec(thumb)
    if (!match) return NextResponse.json({ message: 'Invalid thumbnail path' }, { status: 400 })
    const bucket = match[1]
    const name = match[2]
    const file = storage.bucket(bucket).file(name)
    const expires = Date.now() + 15 * 60 * 1000
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires })
    return NextResponse.json({ url })
  } catch (err: any) {
    console.error('Error generating thumbnail URL', err)
    return NextResponse.json({ message: 'Error', details: err?.message || String(err) }, { status: 500 })
  }
}
