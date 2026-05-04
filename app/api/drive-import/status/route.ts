import { NextResponse } from 'next/server'

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

export async function GET(req: Request) {
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
