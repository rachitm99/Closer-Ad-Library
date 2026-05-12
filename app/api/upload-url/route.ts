import { NextResponse } from 'next/server'

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

async function getAccessToken() {
  const { GoogleAuth } = await import('google-auth-library')
  const raw = process.env.NEXT_SA_KEY
  if (!raw) throw new Error('NEXT_SA_KEY is required for GCS upload')
  const creds = normalizeServiceAccount(raw)
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/devstorage.read_write']
  })
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const token = tokenResponse?.token
  if (!token) throw new Error('Failed to acquire GCS access token')
  return token
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

    const bucketName = process.env.UPLOAD_BUCKET
    const gcsPath = `gs://${bucketName}/${filename}`

    // Get access token for GCS
    const accessToken = await getAccessToken()

    // Create resumable upload session via GCS JSON API
    const resumableUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=resumable`
    
    const metadata = {
      name: filename,
      contentType: contentType
    }

    const resumableRes = await fetch(resumableUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Content-Type': contentType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    })

    if (!resumableRes.ok) {
      const errText = await resumableRes.text()
      console.error('Failed to create resumable session:', resumableRes.status, errText)
      return NextResponse.json({ message: 'Error generating upload URL', details: `${resumableRes.status} ${errText}` }, { status: 500 })
    }

    const uploadUrl = resumableRes.headers.get('location')
    if (!uploadUrl) {
      console.error('No location header in resumable upload response')
      return NextResponse.json({ message: 'Error generating upload URL', details: 'No session URL returned' }, { status: 500 })
    }

    return NextResponse.json({ uploadUrl, gcsPath })
  } catch (err: any) {
    console.error('Error generating upload URL', err)
    const details = err?.message || String(err)
    if (details.includes('Could not load the default credentials')) {
      return NextResponse.json({ message: 'Error generating upload URL', details: 'Could not load credentials. Provide NEXT_SA_KEY or configure Workload Identity Federation.' }, { status: 500 })
    }
    return NextResponse.json({ message: 'Error generating upload URL', details }, { status: 500 })
  }
}
