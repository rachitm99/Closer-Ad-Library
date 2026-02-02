import { NextResponse } from 'next/server'
import { getUidFromAuthHeader } from '../../../lib/firebaseAdmin'
import admin from 'firebase-admin'

const COLLECTION = process.env.TRACKED_ADS_COLLECTION || 'tracked_ads'

export async function GET(req: Request) {
  try {
    const uid = await getUidFromAuthHeader(req.headers)
    if (!uid) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const docRef = admin.firestore().collection(COLLECTION).doc(uid)
    const doc = await docRef.get()
    const data = doc.exists ? doc.data() : {}
    const ads = data?.ads ?? {}
    return NextResponse.json({ ads })
  } catch (err: any) {
    console.error('/api/tracked-ads GET error', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const uid = await getUidFromAuthHeader(req.headers)
    if (!uid) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const adId = String(body.adId ?? '')
    if (!adId) return NextResponse.json({ message: 'Missing adId' }, { status: 400 })

    const adUrl = String(body.adUrl ?? (body.adInfo?.snapshot?.link_url ?? body.adInfo?.url ?? '')) || null
    const adDaysRaw = body.adDays ?? body.days ?? null
    const adDays = adDaysRaw !== null ? (Number.isFinite(Number(adDaysRaw)) ? parseInt(String(adDaysRaw), 10) : null) : null
    const adInfo = body.adInfo ?? null
    const preview = body.preview ?? null
    const queryId = body.queryId ?? 'default'
    const pageId = body.pageId ?? null
    const queryThumbnail = body.queryThumbnail ?? null
    const phashes = body.phashes ?? null
    const isEmpty = body.isEmpty ?? false
    
    console.log('[tracker-ads POST] Saving ad:', adId, 'queryId:', queryId, 'pageId:', pageId, 'hasPreview:', !!preview, 'hasAdInfo:', !!adInfo, 'hasQueryThumbnail:', !!queryThumbnail, 'hasPhashes:', !!phashes, 'isEmpty:', isEmpty)
    
    const docRef = admin.firestore().collection(COLLECTION).doc(uid)
    await docRef.set({ 
      ads: { 
        [adId]: { 
          url: adUrl, 
          days: adDays, 
          adInfo,
          preview,
          queryId,
          pageId,
          queryThumbnail,
          phashes,
          isEmpty,
          addedAt: admin.firestore.FieldValue.serverTimestamp() 
        } 
      } 
    }, { merge: true })
    return NextResponse.json({ ok: true, url: adUrl, days: adDays })
  } catch (err: any) {
    console.error('/api/tracked-ads POST error', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const uid = await getUidFromAuthHeader(req.headers)
    if (!uid) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const adId = String(body.adId ?? '')
    if (!adId) return NextResponse.json({ message: 'Missing adId' }, { status: 400 })

    const liveAdInfo = body.liveAdInfo ?? null
    
    console.log('[tracker-ads PATCH] Updating live data for ad:', adId, 'hasLiveAdInfo:', !!liveAdInfo)
    
    const docRef = admin.firestore().collection(COLLECTION).doc(uid)
    await docRef.update({ 
      [`ads.${adId}.liveAdInfo`]: liveAdInfo,
      [`ads.${adId}.lastFetched`]: admin.firestore.FieldValue.serverTimestamp()
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('/api/tracked-ads PATCH error', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const uid = await getUidFromAuthHeader(req.headers)
    if (!uid) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const adId = String(url.searchParams.get('adId') ?? '')
    const queryId = String(url.searchParams.get('queryId') ?? '')
    
    // Delete by queryId (all ads in a query) or single adId
    if (queryId) {
      console.log('[tracker-ads DELETE] Deleting all ads for queryId:', queryId)
      const docRef = admin.firestore().collection(COLLECTION).doc(uid)
      const doc = await docRef.get()
      let deletedCount = 0
      
      if (doc.exists) {
        const data = doc.data()
        const ads = data?.ads ?? {}
        const updates: Record<string, any> = {}
        
        // Find all ads with matching queryId and mark them for deletion
        Object.keys(ads).forEach(id => {
          if (ads[id].queryId === queryId) {
            updates[`ads.${id}`] = admin.firestore.FieldValue.delete()
          }
        })
        
        if (Object.keys(updates).length > 0) {
          await docRef.update(updates)
          deletedCount = Object.keys(updates).length
          console.log('[tracker-ads DELETE] Deleted', deletedCount, 'ads for queryId:', queryId)
        }
      }
      return NextResponse.json({ ok: true, deleted: deletedCount })
    } else if (adId) {
      console.log('[tracker-ads DELETE] Deleting single ad:', adId)
      const docRef = admin.firestore().collection(COLLECTION).doc(uid)
      await docRef.update({ [`ads.${adId}`]: admin.firestore.FieldValue.delete() })
      return NextResponse.json({ ok: true })
    } else {
      return NextResponse.json({ message: 'Missing adId or queryId' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('/api/tracked-ads DELETE error', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
