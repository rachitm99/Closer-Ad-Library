import { NextResponse } from 'next/server'
import { getUidFromAuthHeader } from '../../../lib/firebaseAdmin'

const COLLECTION = process.env.FIRESTORE_COLLECTION || 'queries'

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
      console.warn('[queries] NEXT_SA_KEY present but failed to parse JSON; falling back to ADC')
    }
  }
  if (!projectId) {
    throw new Error('Firestore project ID missing. Set FIRESTORE_PROJECT_ID or provide NEXT_SA_KEY.')
  }
  return new Firestore({ projectId, preferRest: true })
}

export async function GET(request: Request) {
  try {
    // require auth via Bearer ID token and get UID
    let uid: string
    try {
      uid = await getUidFromAuthHeader(request.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const firestore = await getFirestore()

    // simple list: latest 200 queries for this user
    const limit = Number(process.env.QUERIES_LIST_LIMIT || 200)
    const snapshot = await firestore.collection(COLLECTION).where('uid', '==', uid).orderBy('last_queried', 'desc').limit(limit).get()
    const items: any[] = []
    
    // Fetch each query with its tracked ads from subcollection
    for (const doc of snapshot.docs) {
      const data = doc.data()
      
      // Get tracked ads from subcollection
      const trackedAdsSnapshot = await firestore.collection(COLLECTION).doc(doc.id).collection('tracked_ads').get()
      const trackedAds = trackedAdsSnapshot.docs.map(adDoc => ({
        ...adDoc.data(),
        id: adDoc.id
      }))
      
      items.push({ 
        id: doc.id, 
        ...data,
        tracked_ads: trackedAds
      })
    }
    
    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('Error listing queries', err)
    return NextResponse.json({ message: 'Error listing queries', details: err?.message || String(err) }, { status: 500 })
  }
}
