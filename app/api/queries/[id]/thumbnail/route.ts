import { NextResponse } from 'next/server'
import * as crypto from 'crypto'

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

function generateSignedUrl(bucket: string, object: string, privateKey: string, serviceAccountEmail: string) {
  const expiresIn = 15 * 60 // 15 minutes in seconds
  const expiryTime = Math.floor(Date.now() / 1000) + expiresIn

  const canonicalQueryString = `X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=${encodeURIComponent(
    `${serviceAccountEmail}/${new Date().toISOString().split('T')[0].replace(/-/g, '')}/auto/storage/goog4_request`
  )}&X-Goog-Date=${new Date().toISOString().replace(/-|:/g, '').split('.')[0]}Z&X-Goog-Expires=${expiresIn}&X-Goog-SignedHeaders=host`

  const canonicalRequest = [
    'GET',
    `/${bucket}/${object}`,
    canonicalQueryString,
    'host:storage.googleapis.com\n',
    'host'
  ].join('\n')

  const sha256 = crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  const stringToSign = [
    'GOOG4-RSA-SHA256',
    new Date().toISOString().replace(/-|:/g, '').split('.')[0] + 'Z',
    `${new Date().toISOString().split('T')[0].replace(/-/g, '')}/auto/storage/goog4_request`,
    sha256
  ].join('\n')

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(stringToSign)
    .sign(privateKey, 'hex')

  return `https://storage.googleapis.com/${bucket}/${object}?${canonicalQueryString}&X-Goog-Signature=${signature}`
}

export async function GET(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
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

    let uid: string
    try {
      uid = await (await import('../../../../../lib/firebaseAdmin')).getUidFromAuthHeader(request.headers)
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

    if (data?.uid !== uid) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const thumb = data?.response?.thumbnail_url || data?.thumbnail_url
    if (!thumb) return NextResponse.json({ message: 'No thumbnail' }, { status: 404 })

    // thumb expected as gs://bucket/path
    const match = /(?:gs:\/\/)?([^\/]+)\/(.+)/.exec(thumb)
    if (!match) return NextResponse.json({ message: 'Invalid thumbnail path' }, { status: 400 })
    const bucket = match[1]
    const name = match[2]

    // Generate signed URL without Storage SDK
    if (!process.env.NEXT_SA_KEY) {
      return NextResponse.json({ message: 'Cannot generate signed URL: NEXT_SA_KEY not set' }, { status: 500 })
    }
    
    const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
    const signedUrl = generateSignedUrl(bucket, name, creds.private_key, creds.client_email)
    
    return NextResponse.json({ url: signedUrl })
  } catch (err: any) {
    console.error('Error generating thumbnail URL', err)
    return NextResponse.json({ message: 'Error', details: err?.message || String(err) }, { status: 500 })
  }
}
