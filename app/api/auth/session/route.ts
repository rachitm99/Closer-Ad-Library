import { NextResponse } from 'next/server'
import { createSessionCookie, verifySessionCookie } from '../../../../lib/firebaseAdmin'

const COOKIE_NAME = 'fb_session'
const MAX_AGE = 5 * 24 * 60 * 60 // 5 days in seconds

export async function POST(req: Request) {
  try {
    const { idToken } = await req.json()
    if (!idToken) return NextResponse.json({ message: 'Missing idToken' }, { status: 400 })
    const cookie = await createSessionCookie(idToken, MAX_AGE * 1000)
    const res = NextResponse.json({ ok: true })
    // secure in production
    const isProd = process.env.NODE_ENV === 'production'
    res.headers.append('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; Max-Age=${MAX_AGE}; SameSite=Strict${isProd ? '; Secure' : ''}`)
    return res
  } catch (e: any) {
    console.error('Failed to create session cookie', e)
    return NextResponse.json({ message: 'Failed to create session cookie', details: String(e?.message || e) }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.headers.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict`)
  return res
}

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get('cookie') || ''
    const m = cookieHeader.match(/(?:^|; )fb_session=([^;]+)/)
    if (!m) return NextResponse.json({ authenticated: false })
    const sessionCookie = decodeURIComponent(m[1])
    const decoded = await verifySessionCookie(sessionCookie)
    return NextResponse.json({ authenticated: true, email: decoded.email })
  } catch (e) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
}