import { NextResponse } from 'next/server'
import { Storage } from '@google-cloud/storage'

if (!process.env.UPLOAD_BUCKET) {
  console.warn('UPLOAD_BUCKET not set — upload-url route will fail without this env var')
}

const storage = new Storage()

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
    return NextResponse.json({ message: 'Error generating upload URL', details: err?.message || String(err) }, { status: 500 })
  }
}
