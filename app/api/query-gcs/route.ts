import { NextResponse } from 'next/server'
import { queryAdWithGcs } from '../../actions/queryAd'
import { Storage } from '@google-cloud/storage'

// Storage client: support NEXT_SA_KEY fallback (useful for deployments without ADC)
let storage: Storage
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    storage = new Storage({ credentials: creds })
  } catch (err) {
    console.warn('NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    storage = new Storage()
  }
} else {
  storage = new Storage()
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const gcsPath = body?.gcsPath
    const pageId = body?.pageId
    if (!gcsPath) return NextResponse.json({ message: 'Missing gcsPath' }, { status: 400 })

    // Parse gcsPath: expect format gs://bucket/path/to/object
    const match = /(?:gs:\/\/)?([^\/]+)\/(.+)/.exec(gcsPath)
    if (!match) return NextResponse.json({ message: 'Invalid gcsPath format' }, { status: 400 })
    const bucketName = match[1]
    const objectName = match[2]

    // Enforce MAX_FILE_BYTES (default 500MB)
    const maxBytes = parseInt(process.env.MAX_FILE_BYTES || '500000000', 10)
    try {
      const file = storage.bucket(bucketName).file(objectName)
      const [meta] = await file.getMetadata()
      const size = Number(meta.size || 0)
      if (size > maxBytes) return NextResponse.json({ message: `File too large. Max is ${maxBytes} bytes` }, { status: 413 })
      const res = await queryAdWithGcs(gcsPath, pageId)

      // Optionally delete the uploaded object after successful processing
      if (process.env.DELETE_GCS_AFTER_DOWNLOAD === 'true') {
        try {
          await file.delete()
        } catch (delErr: any) {
          console.warn('Failed to delete GCS object after processing:', delErr?.message || String(delErr))
        }
      }

      return NextResponse.json(res)
    } catch (err: any) {
      console.error('Error while validating or deleting GCS object', err)
      return NextResponse.json({ message: 'Error validating GCS object', details: err?.message || String(err) }, { status: 500 })
    }
  } catch (err: any) {
    console.error('Error in /api/query-gcs', err)
    return NextResponse.json({ message: 'Server error', details: err?.message || String(err) }, { status: 500 })
  }
}
