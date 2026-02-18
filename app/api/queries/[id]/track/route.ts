import { NextRequest, NextResponse } from 'next/server'
import { Firestore, FieldValue } from '@google-cloud/firestore'
import { getUidFromAuthHeader } from '../../../../../lib/firebaseAdmin'

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

// POST - Track a new ad for a query
export async function POST(
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
    const { adId, adInfo, preview, isEmpty } = await req.json()

    const queryRef = firestore.collection(COLLECTION).doc(queryId)
    const queryDoc = await queryRef.get()

    if (!queryDoc.exists) {
      return NextResponse.json({ message: 'Query not found' }, { status: 404 })
    }

    const queryData = queryDoc.data()
    if (queryData?.uid !== uid) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    // Store tracked ad in subcollection
    const trackedAdRef = queryRef.collection('tracked_ads').doc(adId)
    await trackedAdRef.set({
      adId,
      adInfo: adInfo || null,
      preview: preview || null,
      isEmpty: isEmpty || false,
      addedAt: new Date().toISOString(),
      lastFetched: null,
      liveAdInfo: null
    })

    // Also add adId to tracked_ads array in query document for quick reference
    await queryRef.update({
      tracked_ads: FieldValue.arrayUnion(adId)
    })

    return NextResponse.json({ success: true, queryId, adId })
  } catch (err: any) {
    console.error('Error tracking ad:', err)
    return NextResponse.json(
      { message: 'Error tracking ad', details: err?.message || String(err) },
      { status: 500 }
    )
  }
}

// PATCH - Update live ad info for a tracked ad
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
    const adId = String(body.adId ?? '')
    if (!adId) return NextResponse.json({ message: 'Missing adId' }, { status: 400 })

    const liveAdInfo = body.liveAdInfo === undefined ? undefined : body.liveAdInfo
    const adInfoFromBody = body.adInfo === undefined ? undefined : body.adInfo
    const previewFromBody = body.preview === undefined ? undefined : body.preview
    const isEmptyFromBody = body.isEmpty

    const queryRef = firestore.collection(COLLECTION).doc(queryId)
    const queryDoc = await queryRef.get()

    if (!queryDoc.exists) {
      return NextResponse.json({ message: 'Query not found' }, { status: 404 })
    }

    const queryData = queryDoc.data()
    if (queryData?.uid !== uid) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    // Update tracked ad in subcollection: only overwrite fields when we have non-null data
    const trackedAdRef = queryRef.collection('tracked_ads').doc(adId)
    const updates: Record<string, any> = {
      lastFetched: new Date().toISOString()
    }

    if (liveAdInfo !== undefined && liveAdInfo !== null) {
      // update liveAdInfo and also refresh stored adInfo/preview where available
      updates.liveAdInfo = liveAdInfo
      updates.adInfo = liveAdInfo

      const derivedPreview =
        liveAdInfo?.snapshot?.videos?.[0]?.video_preview_image_url ||
        (Array.isArray(liveAdInfo?.snapshot?.videos) ? liveAdInfo.snapshot.videos.find((v: any) => v.video_preview_image_url)?.video_preview_image_url : null) ||
        null
      if (derivedPreview) updates.preview = derivedPreview

      // mark as non-empty when we received usable data
      updates.isEmpty = false
    } else {
      // liveAdInfo explicitly null -> do not overwrite existing adInfo/liveAdInfo/preview
      if (adInfoFromBody !== undefined && adInfoFromBody !== null) updates.adInfo = adInfoFromBody
      if (previewFromBody !== undefined && previewFromBody !== null) updates.preview = previewFromBody
      if (typeof isEmptyFromBody === 'boolean') updates.isEmpty = isEmptyFromBody
    }

    // Apply updates using merge semantics so we don't lose other fields
    await trackedAdRef.set(updates, { merge: true })

    return NextResponse.json({ success: true, queryId, adId })
  } catch (err: any) {
    console.error('Error updating ad:', err)
    return NextResponse.json(
      { message: 'Error updating ad', details: err?.message || String(err) },
      { status: 500 }
    )
  }
}
