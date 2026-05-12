import { NextResponse } from 'next/server'
import * as crypto from 'crypto'

if (!process.env.UPLOAD_BUCKET) {
  console.warn('UPLOAD_BUCKET not set — upload-url route will fail without this env var')
}

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

function generateSignedUrl(bucket: string, object: string, privateKey: string, serviceAccountEmail: string, expiresIn: number = 900) {
  // v4 signed URL generation
  const expiryTime = Math.floor(Date.now() / 1000) + expiresIn
  const datestamp = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const timestamp = new Date().toISOString().replace(/-|:/g, '').split('.')[0] + 'Z'

  const scope = `${datestamp}/auto/storage/goog4_request`
  const credential = `${serviceAccountEmail}/${scope}`

  const canonicalQueryString = [
    `X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    `X-Goog-Credential=${encodeURIComponent(credential)}`,
    `X-Goog-Date=${timestamp}`,
    `X-Goog-Expires=${expiresIn}`,
    `X-Goog-SignedHeaders=host`
  ].sort().join('&')

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${object}`,
    canonicalQueryString,
    'host:storage.googleapis.com\n',
    'host'
  ].join('\n')

  const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex')

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    timestamp,
    scope,
    canonicalRequestHash
  ].join('\n')

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(stringToSign)
    .sign(privateKey, 'hex')

  return `https://storage.googleapis.com/${bucket}/${object}?${canonicalQueryString}&X-Goog-Signature=${signature}`
}

function isValidFilename(name: string) {
  // Basic validation: no path separators and reasonable length
  return typeof name === 'string' && name.length > 0 && name.length <= 256 && !name.includes('/') && !name.includes('..')
}

export async function POST(request: Request) {
  try {
    if (!process.env.UPLOAD_BUCKET) return NextResponse.json({ message: 'Server misconfigured: UPLOAD_BUCKET missing' }, { status: 500 })

    const body = await request.json()
    const filename = body?.filename
    const contentType = body?.contentType

    if (!isValidFilename(filename)) return NextResponse.json({ message: 'Invalid filename' }, { status: 400 })
    if (!contentType || typeof contentType !== 'string') return NextResponse.json({ message: 'Invalid contentType' }, { status: 400 })

    if (!process.env.NEXT_SA_KEY) {
      return NextResponse.json({ message: 'Error generating upload URL', details: 'Service account key not configured' }, { status: 500 })
    }

    const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
    const bucketName = process.env.UPLOAD_BUCKET
    const gcsPath = `gs://${bucketName}/${filename}`

    // Generate v4 signed URL for PUT request (valid for 15 minutes)
    const uploadUrl = generateSignedUrl(bucketName, filename, creds.private_key, creds.client_email, 900)

    return NextResponse.json({ uploadUrl, gcsPath })
  } catch (err: any) {
    console.error('Error generating upload URL', err)
    const details = err?.message || String(err)
    return NextResponse.json({ message: 'Error generating upload URL', details }, { status: 500 })
  }
}
