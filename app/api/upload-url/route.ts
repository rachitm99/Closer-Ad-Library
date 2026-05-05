import { NextResponse } from 'next/server'
if (!process.env.UPLOAD_BUCKET) {
  console.warn('UPLOAD_BUCKET not set — upload-url route will fail without this env var')
}

// Lazy init storage to avoid module-eval issues during Next build
let storage: any

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

function isValidFilename(name: string) {
  // Basic validation: no path separators and reasonable length
  return typeof name === 'string' && name.length > 0 && name.length <= 256 && !name.includes('/') && !name.includes('..')
}

export async function POST(request: Request) {
  try {
    process.env.GOOGLE_CLOUD_DISABLE_PROMISIFY = '1'
    const { Storage } = await import('@google-cloud/storage')
    if (!storage) {
      if (process.env.NEXT_SA_KEY) {
        try {
          const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
          storage = new Storage({ credentials: creds, projectId: creds.project_id })
        } catch (err) {
          console.warn('NEXT_SA_KEY provided but failed to parse JSON; falling back to ADC')
          storage = new Storage()
        }
      } else {
        storage = new Storage()
      }
    }
    if (!process.env.UPLOAD_BUCKET) return NextResponse.json({ message: 'Server misconfigured: UPLOAD_BUCKET missing' }, { status: 500 })

    const body = await request.json()
    const filename = body?.filename
    const contentType = body?.contentType

    if (!isValidFilename(filename)) return NextResponse.json({ message: 'Invalid filename' }, { status: 400 })
    if (!contentType || typeof contentType !== 'string') return NextResponse.json({ message: 'Invalid contentType' }, { status: 400 })

    const bucketName = process.env.UPLOAD_BUCKET
    const file = storage.bucket(bucketName).file(filename)

    const expires = Date.now() + 15 * 60 * 1000 // 15 minutes
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType,
    })

    const gcsPath = `gs://${bucketName}/${filename}`
    return NextResponse.json({ uploadUrl, gcsPath })
  } catch (err: any) {
    console.error('Error generating upload URL', err)
    const details = err?.message || String(err)
    // Common cause: ADC not configured in environment. Provide a helpful hint.
    if (details.includes('Could not load the default credentials')) {
      return NextResponse.json({ message: 'Error generating upload URL', details: 'Could not load credentials. In deployments set up Workload Identity Federation or provide a service account JSON via the NEXT_SA_KEY env var. See README for details.' }, { status: 500 })
    }
    return NextResponse.json({ message: 'Error generating upload URL', details }, { status: 500 })
  }
}
