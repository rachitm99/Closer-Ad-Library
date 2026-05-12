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
    const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES || '500000000', 10)
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
    const contentTypeHeader = res.headers.get('content-type') || 'video/mp4'

    // Upload directly to GCS using JSON API (no Storage SDK)
    const accessToken = await getAccessToken()
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentTypeHeader,
        Authorization: `Bearer ${accessToken}`
      },
      body: res.body as any
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      return NextResponse.json({ error: 'Upload to GCS failed', details: `${uploadRes.status} ${errText}` }, { status: 502 })
    }

    const gcsPath = `gs://${bucketName}/${objectPath}`
    return NextResponse.json({
      success: true,
      gcsPath,
      filename: originalName,
      size: contentLength || 0
    })
  } catch (error: any) {
    console.error('[drive-to-gcs] Error:', error)
    return NextResponse.json({ error: 'Server error', details: error?.message || String(error) }, { status: 500 })
  }
}
