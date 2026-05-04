import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

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

async function getFirestore() {
  const { Firestore } = await import('@google-cloud/firestore')
  const projectId = process.env.FIRESTORE_PROJECT_ID
  if (process.env.NEXT_SA_KEY) {
    const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
    return new Firestore({ projectId: projectId || creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
  }
  if (!projectId) {
    throw new Error('Firestore project ID missing. Set FIRESTORE_PROJECT_ID or provide NEXT_SA_KEY.')
  }
  return new Firestore({ projectId })
}

export async function GET() {
  try {
    const firestore = await getFirestore()
    const docRef = firestore.collection('_debug').doc('firestore-ping')
    await docRef.set({ ok: true, ts: Date.now() }, { merge: true })
    const snap = await docRef.get()

    return NextResponse.json({
      ok: snap.exists,
      projectId: firestore.projectId,
      hasNextSaKey: Boolean(process.env.NEXT_SA_KEY),
      docId: snap.id
    })
  } catch (error: any) {
    console.error('[debug-firestore] Error:', error)
    return NextResponse.json({ error: 'Firestore debug failed', details: error?.message || String(error) }, { status: 500 })
  }
}
