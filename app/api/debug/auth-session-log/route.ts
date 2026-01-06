import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const p = path.resolve(process.cwd(), 'logs', 'auth-session.log')
    if (!fs.existsSync(p)) return NextResponse.json({ lines: [] })
    const txt = fs.readFileSync(p, 'utf8')
    const lines = txt.split('\n').filter(Boolean).slice(-200)
    return NextResponse.json({ lines })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}