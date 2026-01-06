import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const keys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
]

export async function GET() {
  // Check env in process.env
  const present: Record<string, boolean> = {}
  keys.forEach(k => { present[k] = !!process.env[k] })
  const allPresent = Object.values(present).every(Boolean)

  return NextResponse.json({ configured: allPresent, present })
}

export async function POST() {
  // Append placeholders to .env.local for missing keys (local convenience only)
  try {
    const envPath = path.resolve(process.cwd(), '.env.local')
    let content = ''
    try { content = fs.readFileSync(envPath, 'utf8') } catch (e) { content = '' }

    let appended: string[] = []
    keys.forEach(k => {
      if (!process.env[k] && !new RegExp(`^${k}=`, 'm').test(content)) {
        content += `\n# TODO: set ${k}\n# ${k}=your_value_here\n`
        appended.push(k)
      }
    })

    if (appended.length > 0) fs.writeFileSync(envPath, content, 'utf8')

    return NextResponse.json({ appended, message: appended.length ? 'Appended placeholder keys to .env.local' : 'No keys appended; all present or already present as placeholders' })
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}
