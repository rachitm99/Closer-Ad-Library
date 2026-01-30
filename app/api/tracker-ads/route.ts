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

    // Prefer explicit adUrl in body; otherwise extract from adInfo if provided
    const adUrl = String(body.adUrl ?? (body.adInfo?.snapshot?.link_url ?? body.adInfo?.url ?? '')) || null
    const adDaysRaw = body.adDays ?? body.days ?? null
    const adDays = adDaysRaw !== null ? (Number.isFinite(Number(adDaysRaw)) ? parseInt(String(adDaysRaw), 10) : null) : null
    const docRef = admin.firestore().collection(COLLECTION).doc(uid)
    await docRef.set({ ads: { [adId]: { url: adUrl, days: adDays, addedAt: admin.firestore.FieldValue.serverTimestamp() } } }, { merge: true })
    return NextResponse.json({ ok: true, url: adUrl, days: adDays })
  } catch (err: any) {
    console.error('/api/tracked-ads POST error', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const uid = await getUidFromAuthHeader(req.headers)
    if (!uid) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const adId = String(url.searchParams.get('adId') ?? '')
    if (!adId) return NextResponse.json({ message: 'Missing adId' }, { status: 400 })

    const docRef = admin.firestore().collection(COLLECTION).doc(uid)
    await docRef.update({ [`ads.${adId}`]: admin.firestore.FieldValue.delete() })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('/api/tracked-ads DELETE error', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
