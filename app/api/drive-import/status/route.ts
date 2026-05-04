import { NextResponse } from 'next/server'

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

export async function GET(req: Request) {
  return NextResponse.json({ error: 'Drive imports are disabled on this deployment.' }, { status: 503 })
  try {
    const url = new URL(req.url)
    const jobId = String(url.searchParams.get('jobId') || '').trim()
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })

    const firestore = await getFirestore()
    const doc = await firestore.collection('drive_imports').doc(jobId).get()
    if (!doc.exists) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    return NextResponse.json(doc.data())
  } catch (error: any) {
    console.error('[drive-import] Status error:', error)
    return NextResponse.json({ error: 'Server error', details: error?.message || String(error) }, { status: 500 })
  }
}
