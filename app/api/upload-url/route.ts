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

function generateSignedUrl(bucket: string, filename: string, contentType: string, serviceAccountEmail: string, privateKey: string) {
  // Generate v4 signed URL for PUT request with content-type
  const expiresIn = 15 * 60 // 15 minutes in seconds
  const now = new Date()
  const isoDatetime = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const datestamp = isoDatetime.substring(0, 8)
  
  const credentialScope = `${datestamp}/auto/storage/goog4_request`
  const credential = `${serviceAccountEmail}/${credentialScope}`
  
  // Signed headers in the query string (must be sorted, space-separated in the header)
  const signedHeaders = 'content-type;host'
  
  // Build canonical query string
  const queryParams = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': credential,
    'X-Goog-Date': isoDatetime,
    'X-Goog-Expires': String(expiresIn),
    'X-Goog-SignedHeaders': signedHeaders
  }
  
  const canonicalQueryString = Object.entries(queryParams)
    .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
    .sort()
    .join('&')
  
  // Canonical request for signature
  const canonicalRequest = [
    'PUT',
    `/${bucket}/${filename}`,
    canonicalQueryString,
    `content-type:${contentType}`,
    'host:storage.googleapis.com',
    '',
    signedHeaders
  ].join('\n')
  
  // Hash the canonical request
  const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  
  // String to sign
  const stringToSign = [
    'GOOG4-RSA-SHA256',
    isoDatetime,
    credentialScope,
    canonicalRequestHash
  ].join('\n')
  
  // Create signature
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(stringToSign)
    .sign(privateKey, 'hex')
  
  return `https://storage.googleapis.com/${bucket}/${filename}?${canonicalQueryString}&X-Goog-Signature=${signature}`
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

    // Generate v4 signed URL for PUT request with content-type (valid for 15 minutes)
    const uploadUrl = generateSignedUrl(bucketName, filename, contentType, creds.client_email, creds.private_key)

    return NextResponse.json({ uploadUrl, gcsPath })
  } catch (err: any) {
    console.error('Error generating upload URL', err)
    const details = err?.message || String(err)
    return NextResponse.json({ message: 'Error generating upload URL', details }, { status: 500 })
  }
}
