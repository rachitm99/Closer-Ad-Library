import { NextRequest, NextResponse } from 'next/server'
import { Firestore } from '@google-cloud/firestore'
import { getUidFromAuthHeader } from '../../../../lib/firebaseAdmin'

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

// GET - Get a specific query with its tracked ads
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let uid: string
    try {
      uid = await getUidFromAuthHeader(req.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const queryId = id
    const queryRef = firestore.collection(COLLECTION).doc(queryId)
    const queryDoc = await queryRef.get()

    if (!queryDoc.exists) {
      return NextResponse.json({ message: 'Query not found' }, { status: 404 })
    }

    const queryData = queryDoc.data()
    if (queryData?.uid !== uid) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    // Get tracked ads from subcollection
    const trackedAdsSnapshot = await queryRef.collection('tracked_ads').get()
    const trackedAds = trackedAdsSnapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id
    }))

    return NextResponse.json({
      queryId,
      ...queryData,
      tracked_ads: trackedAds
    })
  } catch (err: any) {
    console.error('Error fetching query:', err)
    return NextResponse.json(
      { message: 'Error fetching query', details: err?.message || String(err) },
      { status: 500 }
    )
  }
}

// DELETE - Delete a query and all its tracked ads
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let uid: string
    try {
      uid = await getUidFromAuthHeader(req.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const queryId = id
    const queryRef = firestore.collection(COLLECTION).doc(queryId)
    const queryDoc = await queryRef.get()

    if (!queryDoc.exists) {
      return NextResponse.json({ message: 'Query not found' }, { status: 404 })
    }

    const queryData = queryDoc.data()
    if (queryData?.uid !== uid) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    // Delete all tracked ads in subcollection
    const trackedAdsSnapshot = await queryRef.collection('tracked_ads').get()
    const batch = firestore.batch()
    trackedAdsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref)
    })

    // Delete the query document
    batch.delete(queryRef)
    await batch.commit()

    return NextResponse.json({ success: true, queryId })
  } catch (err: any) {
    console.error('Error deleting query:', err)
    return NextResponse.json(
      { message: 'Error deleting query', details: err?.message || String(err) },
      { status: 500 }
    )
  }
}

// PATCH - Update query metadata (uid, page_id, days, thumbnail_url, uploaded_video)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let uid: string
    try {
      uid = await getUidFromAuthHeader(req.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const queryId = id
    const body = await req.json()

    const queryRef = firestore.collection(COLLECTION).doc(queryId)
    const queryDoc = await queryRef.get()

    if (!queryDoc.exists) {
      return NextResponse.json({ message: 'Query not found' }, { status: 404 })
    }

    // Prepare update data - only include provided fields
    const updateData: any = {
      uid, // Always set uid from auth
      last_queried: new Date().toISOString()
    }

    if (body.page_id !== undefined) updateData.page_id = body.page_id
    if (body.days !== undefined) updateData.days = body.days
    if (body.thumbnail_url !== undefined) updateData.thumbnail_url = body.thumbnail_url
    if (body.uploaded_video !== undefined) updateData.uploaded_video = body.uploaded_video
    if (body.update_refresh_time === true) updateData.last_refreshed = new Date().toISOString()
    
    // Set last_refreshed to last_queried if not already set (for initial queries)
    const existingData = queryDoc.data()
    if (!existingData?.last_refreshed) {
      updateData.last_refreshed = updateData.last_queried
    }

    // Update the document (preserves existing fields like response with phashes)
    await queryRef.update(updateData)

    return NextResponse.json({ success: true, queryId })
  } catch (err: any) {
    console.error('Error updating query:', err)
    return NextResponse.json(
      { message: 'Error updating query', details: err?.message || String(err) },
      { status: 500 }
    )
  }
}
