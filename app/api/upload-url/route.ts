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

function isValidFilename(name: string) {
  return typeof name === 'string' && name.length > 0 && name.length <= 256 && !name.includes('/') && !name.includes('..')
}

export async function POST(request: Request) {
  try {
    if (!process.env.UPLOAD_BUCKET) {
      return NextResponse.json({ message: 'Server misconfigured: UPLOAD_BUCKET missing' }, { status: 500 })
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
    const storage = await createStorageClient()
    const file = storage.bucket(bucketName).file(filename)
    const expires = Date.now() + 15 * 60 * 1000

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType,
    })

    const gcsPath = `gs://${bucketName}/${filename}`

    console.log('[upload-url] Generated signed URL for:', filename)
    return NextResponse.json({ uploadUrl, gcsPath })
  } catch (err: any) {
    console.error('Error generating upload URL', err)
    const details = err?.message || String(err)
    if (details.includes('Could not load the default credentials')) {
      return NextResponse.json({ message: 'Error generating upload URL', details: 'Could not load credentials. Provide NEXT_SA_KEY or ADC.' }, { status: 500 })
    }
    return NextResponse.json({ message: 'Error generating upload URL', details }, { status: 500 })
  }
}
