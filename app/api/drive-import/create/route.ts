import { NextResponse } from 'next/server'
import * as crypto from 'crypto'

export const runtime = 'nodejs'

async function getFirestore() {
  const { Firestore } = await import('@google-cloud/firestore')
  if (process.env.NEXT_SA_KEY) {
    try {
      const creds = JSON.parse(process.env.NEXT_SA_KEY)
      return new Firestore({ projectId: creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
    } catch (err) {
      console.warn('[drive-import] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    }
  }
  return new Firestore()
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
    return NextResponse.json({ error: 'Server error', details: error?.message || String(error) }, { status: 500 })
  }
}
