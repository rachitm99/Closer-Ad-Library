import { NextResponse } from 'next/server'
import * as crypto from 'crypto'

export const runtime = 'nodejs'

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
      return new Firestore({ projectId: projectId || creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key }, preferRest: true })
    } catch (err) {
      console.warn('[drive-import] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    }
  }
  if (!projectId) {
    throw new Error('Firestore project ID missing. Set FIRESTORE_PROJECT_ID or provide NEXT_SA_KEY.')
  }
  return new Firestore({ projectId, preferRest: true })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const driveUrl = String(body?.driveUrl || '').trim()
    if (!driveUrl) return NextResponse.json({ error: 'Google Drive URL is required' }, { status: 400 })

    const firestore = await getFirestore()
    const jobId = crypto.randomBytes(16).toString('hex')
    const now = Date.now()

    await firestore.collection('drive_imports').doc(jobId).set({
      jobId,
      driveUrl,
      status: 'queued',
      stage: 'queued',
      createdAt: now,
      updatedAt: now
    })

    return NextResponse.json({ jobId })
  } catch (error: any) {
    console.error('[drive-import] Create error:', error)
    const details = error?.message || String(error)
    return NextResponse.json({ error: 'Server error', details }, { status: 500 })
  }
}
