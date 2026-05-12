import { NextResponse } from 'next/server'
import { createHmac, createHash } from 'crypto'

if (!process.env.UPLOAD_BUCKET) {
  console.warn('UPLOAD_BUCKET not set — upload-url route will fail without this env var')
}

function normalizeServiceAccount(raw: string) {
  let creds: any
  try {
    creds = JSON.parse(raw)
  } catch {
    // Try base64 decode if JSON parse fails
    const decoded = Buffer.from(raw, 'base64').toString('utf8')
    creds = JSON.parse(decoded)
  }
  if (creds.private_key && typeof creds.private_key === 'string') {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n')
  }
  return creds
}

function isValidFilename(name: string) {
  // Basic validation: no path separators and reasonable length
  return typeof name === 'string' && name.length > 0 && name.length <= 256 && !name.includes('/') && !name.includes('..')
}

function generateV4SignedUrl(
  bucketName: string,
  filename: string,
  contentType: string,
  privateKey: string,
  clientEmail: string,
  expirationMinutes: number = 15
): string {
  const expirationSeconds = Math.floor(Date.now() / 1000) + expirationMinutes * 60
  
  // Create canonical request string for signing
  const httpMethod = 'PUT'
  const canonicalUri = `/${bucketName}/${filename}`
  const canonicalQueryString = ''
  
  const canonicalHeaders = `content-type:${contentType}\nhost:storage.googleapis.com\n`
  const signedHeaders = 'content-type;host'
  
  const payloadHash = createHash('sha256').update('').digest('hex')
  
  const canonicalRequest = `${httpMethod}
${canonicalUri}
${canonicalQueryString}
${canonicalHeaders}
${signedHeaders}
${payloadHash}`

  console.log('[upload-url] Canonical request:', canonicalRequest)

  // Create string to sign
  const requestHash = createHash('sha256').update(canonicalRequest).digest('hex')
  const algorithm = 'GOOG4-RSA-SHA256'
  const credentialScope = `${new Date().toISOString().split('T')[0]}/auto/storage/goog4_request`
  const stringToSign = `${algorithm}
${new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '')}
${credentialScope}
${requestHash}`

  console.log('[upload-url] String to sign:', stringToSign)

  // Sign with private key
  const signature = createHmac('sha256', privateKey)
    .update(stringToSign)
    .digest('hex')

  console.log('[upload-url] Signature:', signature.substring(0, 20) + '...')

  // Build signed URL
  const baseUrl = `https://storage.googleapis.com${canonicalUri}`
  const params = new URLSearchParams({
    'X-Goog-Algorithm': algorithm,
    'X-Goog-Credential': `${clientEmail}/${credentialScope}`,
    'X-Goog-Date': new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, ''),
    'X-Goog-Expires': (expirationMinutes * 60).toString(),
    'X-Goog-SignedHeaders': signedHeaders,
    'X-Goog-Signature': signature,
  })

  return `${baseUrl}?${params.toString()}`
}

export async function POST(request: Request) {
  try {
    if (!process.env.UPLOAD_BUCKET) {
      return NextResponse.json({ message: 'Server misconfigured: UPLOAD_BUCKET missing' }, { status: 500 })
    }
    if (!process.env.NEXT_SA_KEY) {
      return NextResponse.json({ message: 'Server misconfigured: NEXT_SA_KEY missing' }, { status: 500 })
    }

    const body = await request.json()
    const filename = body?.filename
    const contentType = body?.contentType

    if (!isValidFilename(filename)) {
      return NextResponse.json({ message: 'Invalid filename' }, { status: 400 })
    }
    if (!contentType || typeof contentType !== 'string') {
      return NextResponse.json({ message: 'Invalid contentType' }, { status: 400 })
    }

    const bucketName = process.env.UPLOAD_BUCKET
    const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)

    const uploadUrl = generateV4SignedUrl(
      bucketName,
      filename,
      contentType,
      creds.private_key,
      creds.client_email,
      15
    )

    const gcsPath = `gs://${bucketName}/${filename}`

    console.log('[upload-url] Generated signed URL for:', filename)
    return NextResponse.json({ uploadUrl, gcsPath })
  } catch (err: any) {
    console.error('Error generating upload URL', err)
    const details = err?.message || String(err)
    return NextResponse.json({ message: 'Error generating upload URL', details }, { status: 500 })
  }
}
