import { NextResponse } from 'next/server'
import { createSessionCookie, verifySessionCookie } from '../../../../lib/firebaseAdmin'

const COOKIE_NAME = 'fb_session'
const MAX_AGE = 5 * 24 * 60 * 60 // 5 days in seconds

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const idToken = body?.idToken
    const now = new Date().toISOString()
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const ua = req.headers.get('user-agent') || 'unknown'

    const appendLog = (entry: string) => {
      try {
        const fs = require('fs')
        const path = require('path')
        const logDir = path.resolve(process.cwd(), 'logs')
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir)
        const p = path.join(logDir, 'auth-session.log')
        fs.appendFileSync(p, entry + '\n')
      } catch (err) {
        console.warn('Failed to append log', err)
      }
    }

    if (!idToken) {
      const msg = `${now} [POST /api/auth/session] Missing idToken from ${ip} UA:${ua}`
      console.warn(msg)
      appendLog(msg)
      return NextResponse.json({ message: 'Missing idToken' }, { status: 400 })
    }

    try {
      // verify id token first and log decoded
      const decoded = await (await import('../../../../lib/firebaseAdmin')).verifyIdToken(idToken)
      const msg = `${now} [POST /api/auth/session] verifyIdToken success. uid:${decoded.uid} email:${decoded.email} ip:${ip} ua:${ua}`
      console.info(msg)
      appendLog(msg)
    } catch (verErr: any) {
      const msg = `${now} [POST /api/auth/session] verifyIdToken failed: ${String(verErr?.message || verErr)} ip:${ip} ua:${ua}`
      console.error(msg)
      appendLog(msg)
      return NextResponse.json({ message: 'Invalid idToken', details: String(verErr?.message || verErr) }, { status: 401 })
    }

    try {
      const cookie = await createSessionCookie(idToken, MAX_AGE * 1000)
      const res = NextResponse.json({ ok: true })
      // secure in production
      const isProd = process.env.NODE_ENV === 'production'
      res.headers.append('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; Max-Age=${MAX_AGE}; SameSite=Strict${isProd ? '; Secure' : ''}`)
      const msg = `${now} [POST /api/auth/session] Created session cookie for ip:${ip} ua:${ua}`
      console.info(msg)
      appendLog(msg)
      return res
    } catch (e: any) {
      const msg = `${now} [POST /api/auth/session] createSessionCookie failed: ${String(e?.message || e)} ip:${ip} ua:${ua}`
      console.error(msg)
      appendLog(msg)
      return NextResponse.json({ message: 'Failed to create session cookie', details: String(e?.message || e) }, { status: 500 })
    }
  } catch (e: any) {
    const now = new Date().toISOString()
    const msg = `${now} [POST /api/auth/session] unexpected error: ${String(e?.message || e)}`
    console.error(msg)
    try { require('fs').appendFileSync(require('path').resolve(process.cwd(), 'logs', 'auth-session.log'), msg + '\n') } catch (err) {}
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