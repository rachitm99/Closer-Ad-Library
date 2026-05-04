import { NextResponse } from 'next/server'
import * as crypto from 'crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES || '500000000', 10)

function extractDriveFileId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (!url.hostname.includes('drive.google.com')) return null

    const parts = url.pathname.split('/').filter(Boolean)
    const fileIndex = parts.indexOf('d')
    if (fileIndex >= 0 && parts[fileIndex + 1]) return parts[fileIndex + 1]

    const idParam = url.searchParams.get('id')
    if (idParam) return idParam
  } catch {
    return null
  }
  return null
}

function buildDownloadUrl(fileId: string, confirm?: string) {
  const base = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
  return confirm ? `${base}&confirm=${encodeURIComponent(confirm)}` : base
}

function parseConfirmToken(html: string): string | null {
  const match = html.match(/confirm=([0-9A-Za-z_]+)[&"]/)
  return match ? match[1] : null
}

function parseFilenameFromDisposition(headerValue: string | null): string | null {
  if (!headerValue) return null
  const filenameStar = headerValue.match(/filename\*=UTF-8''([^;]+)/i)
  if (filenameStar && filenameStar[1]) return decodeURIComponent(filenameStar[1])

  const filename = headerValue.match(/filename="?([^";]+)"?/i)
  return filename && filename[1] ? filename[1] : null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const driveUrl = String(body?.driveUrl || '').trim()
    if (!driveUrl) return NextResponse.json({ error: 'Google Drive URL is required' }, { status: 400 })

    const fileId = extractDriveFileId(driveUrl)
    if (!fileId) return NextResponse.json({ error: 'Invalid Google Drive link' }, { status: 400 })

    const { Storage } = await import('@google-cloud/storage')
    let storageClient: any = null
    if (process.env.NEXT_SA_KEY) {
      try {
        const creds = JSON.parse(process.env.NEXT_SA_KEY)
        storageClient = new Storage({ credentials: creds })
      } catch (err) {
        console.warn('[drive-to-gcs] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
      }
    }
    if (!storageClient) storageClient = new Storage()

    const downloadUrl = buildDownloadUrl(fileId)
    let res = await fetch(downloadUrl, { redirect: 'follow' })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch Google Drive file', status: res.status }, { status: 502 })
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('text/html')) {
      const html = await res.text()
      const confirm = parseConfirmToken(html)
      if (!confirm) {
        return NextResponse.json({ error: "Google Drive link is not publicly accessible. Set sharing to 'Anyone with the link'." }, { status: 403 })
      }
      res = await fetch(buildDownloadUrl(fileId, confirm), { redirect: 'follow' })
      if (!res.ok) {
        return NextResponse.json({ error: 'Failed to confirm Google Drive download', status: res.status }, { status: 502 })
      }
    }

    const contentLength = Number(res.headers.get('content-length') || '0')
    if (contentLength > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File exceeds max size (500MB). Please upload a smaller video.' }, { status: 413 })
    }

    if (!res.body) {
      return NextResponse.json({ error: 'Google Drive response body missing' }, { status: 502 })
    }

    const bucketName = process.env.UPLOAD_BUCKET
    if (!bucketName) return NextResponse.json({ error: 'UPLOAD_BUCKET not configured' }, { status: 500 })

    const disposition = res.headers.get('content-disposition')
    const originalName = parseFilenameFromDisposition(disposition) || `drive-${fileId}.mp4`
    const extMatch = originalName.match(/\.[A-Za-z0-9]+$/)
    const ext = extMatch ? extMatch[0] : '.mp4'

    const objectPath = `uploads/drive-${fileId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
    const bucket = storageClient!.bucket(bucketName)
    const file = bucket.file(objectPath)
    if (!(file as any).bucket) (file as any).bucket = bucket

    const writeStream = file.createWriteStream({
      contentType: res.headers.get('content-type') || 'video/mp4',
      metadata: {
        metadata: {
          source: 'drive',
          fileId,
          originalUrl: driveUrl
        }
      }
    })

    let totalBytes = 0
    const limitTransform = new Transform({
      transform(chunk, _encoding, callback) {
        totalBytes += chunk.length
        if (totalBytes > MAX_FILE_BYTES) {
          callback(new Error('File exceeds max size (500MB). Please upload a smaller video.'))
          return
        }
        callback(null, chunk)
      }
    })

    const readable = Readable.fromWeb(res.body as any)
    await pipeline(readable, limitTransform, writeStream)

    const gcsPath = `gs://${bucketName}/${objectPath}`
    return NextResponse.json({
      success: true,
      gcsPath,
      filename: originalName,
      size: totalBytes
    })
  } catch (error: any) {
    console.error('[drive-to-gcs] Error:', error)
    return NextResponse.json({ error: 'Server error', details: error?.message || String(error) }, { status: 500 })
  }
}
