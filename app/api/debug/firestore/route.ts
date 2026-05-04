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

function validateServiceAccount(creds: any) {
  const missing: string[] = []
  if (!creds || typeof creds !== 'object') missing.push('object')
  if (!creds?.project_id) missing.push('project_id')
  if (!creds?.client_email) missing.push('client_email')
  if (!creds?.private_key) missing.push('private_key')
  return missing
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
  return NextResponse.json({ error: 'Firestore debug is disabled on this deployment.' }, { status: 403 })
  try {
    const firestore = await getFirestore()
    const docRef = firestore.collection('_debug').doc('firestore-ping')
    await docRef.set({ ok: true, ts: Date.now() }, { merge: true })
    const snap = await docRef.get()

    const projectId = typeof (firestore as any)?.projectId === 'string'
      ? (firestore as any).projectId
      : process.env.FIRESTORE_PROJECT_ID || null

    return NextResponse.json({
      ok: snap.exists,
      projectId,
      hasNextSaKey: Boolean(process.env.NEXT_SA_KEY),
      docId: snap.id
    })
  } catch (error: any) {
    console.error('[debug-firestore] Error:', error)
    const details = error?.message || String(error)
    const code = error?.code ?? null
    const name = error?.name ?? null
    const stack = typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 3).join('\n') : null
    let saMissing: string[] | null = null
    let saProject: string | null = null
    if (process.env.NEXT_SA_KEY) {
      try {
        const creds = normalizeServiceAccount(process.env.NEXT_SA_KEY)
        saMissing = validateServiceAccount(creds)
        saProject = creds?.project_id || null
      } catch (saErr: any) {
        saMissing = ['invalid_json']
      }
    }
    return NextResponse.json({ error: 'Firestore debug failed', details, code, name, stack, saMissing, saProject }, { status: 500 })
  }
}
