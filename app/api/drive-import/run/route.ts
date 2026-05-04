import { NextResponse } from 'next/server'
import * as crypto from 'crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES || '500000000', 10)

async function getFirestore() {
  const { Firestore } = await import('@google-cloud/firestore')
  const projectId = process.env.FIRESTORE_PROJECT_ID
  if (process.env.NEXT_SA_KEY) {
    try {
      let raw = process.env.NEXT_SA_KEY
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
      return new Firestore({ projectId: projectId || creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
    } catch (err) {
      console.warn('[drive-import] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    }
  }
  if (!projectId) {
    throw new Error('Firestore project ID missing. Set FIRESTORE_PROJECT_ID or provide NEXT_SA_KEY.')
  }
  return new Firestore({ projectId })
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

async function updateJob(docRef: FirebaseFirestore.DocumentReference, data: Record<string, any>) {
  const payload = { ...data, updatedAt: Date.now() }
  await docRef.set(payload, { merge: true })
}

export async function POST(req: Request) {
  return NextResponse.json({ error: 'Drive imports are disabled on this deployment.' }, { status: 503 })
  let jobId = ''
  try {
    const body = await req.json()
    jobId = String(body?.jobId || '').trim()
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })

    const firestore = await getFirestore()
    const docRef = firestore.collection('drive_imports').doc(jobId)
    const jobSnap = await docRef.get()
    if (!jobSnap.exists) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const job = jobSnap.data() || {}
    if (job.status === 'done' && job.gcsPath) {
      return NextResponse.json({ gcsPath: job.gcsPath, jobId })
    }

    const driveUrl = String(job.driveUrl || '').trim()
    if (!driveUrl) return NextResponse.json({ error: 'Drive URL missing on job' }, { status: 400 })

    const fileId = extractDriveFileId(driveUrl)
    if (!fileId) return NextResponse.json({ error: 'Invalid Google Drive link' }, { status: 400 })

    await updateJob(docRef, { status: 'running', stage: 'checking', error: null })

    const { Storage } = await import('@google-cloud/storage')
    let storageClient: any = null
    if (process.env.NEXT_SA_KEY) {
      try {
        const creds = JSON.parse(process.env.NEXT_SA_KEY)
        storageClient = new Storage({ credentials: creds })
      } catch (err) {
        console.warn('[drive-import] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
      }
    }
    if (!storageClient) storageClient = new Storage()

    let res = await fetch(buildDownloadUrl(fileId), { redirect: 'follow' })
    if (!res.ok) {
      await updateJob(docRef, { status: 'failed', stage: 'checking', error: `Failed to fetch Google Drive file (${res.status})` })
      return NextResponse.json({ error: 'Failed to fetch Google Drive file', status: res.status }, { status: 502 })
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('text/html')) {
      const html = await res.text()
      const confirm = parseConfirmToken(html)
      if (!confirm) {
        await updateJob(docRef, { status: 'failed', stage: 'checking', error: "Google Drive link is not publicly accessible. Set sharing to 'Anyone with the link'." })
        return NextResponse.json({ error: "Google Drive link is not publicly accessible. Set sharing to 'Anyone with the link'." }, { status: 403 })
      }
      res = await fetch(buildDownloadUrl(fileId, confirm), { redirect: 'follow' })
      if (!res.ok) {
        await updateJob(docRef, { status: 'failed', stage: 'checking', error: `Failed to confirm Google Drive download (${res.status})` })
        return NextResponse.json({ error: 'Failed to confirm Google Drive download', status: res.status }, { status: 502 })
      }
    }

    const totalBytes = Number(res.headers.get('content-length') || '0')
    if (totalBytes > MAX_FILE_BYTES) {
      await updateJob(docRef, { status: 'failed', stage: 'checking', error: 'File exceeds max size (500MB). Please upload a smaller video.' })
      return NextResponse.json({ error: 'File exceeds max size (500MB). Please upload a smaller video.' }, { status: 413 })
    }

    if (!res.body) {
      await updateJob(docRef, { status: 'failed', stage: 'checking', error: 'Google Drive response body missing' })
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

    let receivedBytes = 0
    let lastUpdateAt = 0
    const limitTransform = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_FILE_BYTES) {
          callback(new Error('File exceeds max size (500MB). Please upload a smaller video.'))
          return
        }
        const now = Date.now()
        if (now - lastUpdateAt > 2000) {
          lastUpdateAt = now
          void updateJob(docRef, {
            status: 'running',
            stage: 'uploading',
            bytesReceived: receivedBytes,
            totalBytes
          })
        }
        callback(null, chunk)
      }
    })

    await updateJob(docRef, { status: 'running', stage: 'uploading', bytesReceived: 0, totalBytes })

    const readable = Readable.fromWeb(res.body as any)
    await pipeline(readable, limitTransform, writeStream)

    const gcsPath = `gs://${bucketName}/${objectPath}`
    await updateJob(docRef, { status: 'done', stage: 'done', gcsPath, bytesReceived: receivedBytes, totalBytes })

    return NextResponse.json({ gcsPath, jobId })
  } catch (error: any) {
    console.error('[drive-import] Run error:', error)
    const message = error?.message || String(error)
    try {
      if (jobId) {
        const firestore = await getFirestore()
        await firestore.collection('drive_imports').doc(jobId).set({ status: 'failed', stage: 'failed', error: message, updatedAt: Date.now() }, { merge: true })
      }
    } catch (updateErr) {
      console.warn('[drive-import] Failed to persist error status', updateErr)
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
