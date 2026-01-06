import { NextResponse } from 'next/server'
import { Firestore } from '@google-cloud/firestore'

// Initialize Firestore with optional NEXT_SA_KEY fallback
let firestore: Firestore
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    firestore = new Firestore({ projectId: creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
  } catch (e) {
    console.warn('NEXT_SA_KEY present but failed to parse; falling back to ADC')
    firestore = new Firestore()
  }
} else {
  firestore = new Firestore()
}

const COLLECTION = process.env.FIRESTORE_COLLECTION || 'queries'

import { getEmailFromAuthHeader } from '../../../lib/firebaseAdmin'

export async function GET(request: Request) {
  try {
    // require auth via Bearer ID token
    let userEmail: string | undefined
    try {
      userEmail = await getEmailFromAuthHeader(request.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    // simple list: latest 200 queries for this user
    const limit = Number(process.env.QUERIES_LIST_LIMIT || 200)
    const snapshot = await firestore.collection(COLLECTION).where('owner', '==', userEmail).orderBy('last_queried', 'desc').limit(limit).get()
    const items: any[] = []
    snapshot.forEach(doc => {
      const data = doc.data()
      items.push({ id: doc.id, ...data })
    })
    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('Error listing queries', err)
    return NextResponse.json({ message: 'Error listing queries', details: err?.message || String(err) }, { status: 500 })
  }
}
