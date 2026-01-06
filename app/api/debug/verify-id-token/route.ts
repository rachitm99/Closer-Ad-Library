import { NextResponse } from 'next/server'
import { verifyIdToken } from '../../../../lib/firebaseAdmin'

export async function POST(req: Request) {
  try {
    const { idToken } = await req.json()
    if (!idToken) return NextResponse.json({ message: 'Missing idToken' }, { status: 400 })
    try {
      const decoded = await verifyIdToken(idToken)
      return NextResponse.json({ ok: true, decoded })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}