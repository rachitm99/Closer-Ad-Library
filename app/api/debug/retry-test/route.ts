import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../../lib/getIdToken'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { query_id?: string }
    const query_id = body?.query_id ?? '142475a1f39b'

    if (!process.env.CLOUD_RUN_URL) return NextResponse.json({ message: 'CLOUD_RUN_URL not set' }, { status: 500 })
    const audience = process.env.CLOUD_RUN_URL
    const retryUrl = (process.env.CLOUD_RUN_RETRY_URL || `${audience.replace(/\/$/, '')}/retry`)

    const client = await getIdTokenClient(audience)

    // Try to fetch an identity token explicitly so we can decode the payload and know the caller principal
    let tokenPayload: any = null
    let rawToken: string | null = null
    try {
      // IdTokenClient exposes fetchIdToken in newer google-auth-library versions
      const token = await (client as any).fetchIdToken?.(audience) || null
      if (token) {
        rawToken = token
        const parts = token.split('.')
        if (parts.length >= 2) {
          const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/')
          const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4)
          const json = Buffer.from(padded, 'base64').toString()
          tokenPayload = JSON.parse(json)
        }
      } else {
        tokenPayload = { note: 'fetchIdToken did not return a token; client.request still attaches tokens when making requests' }
      }
    } catch (e) {
      tokenPayload = { error: 'failed to fetch/decode token', detail: String(e) }
    }

    // Perform the same POST as your curl (multipart/form-data) but attach the explicit token in Authorization header
    const form = new (global as any).FormData()
    form.append('query_id', query_id)
    let upstream: any = {}
    try {
      const headers: any = {}
      if (rawToken) headers['Authorization'] = `Bearer ${rawToken}`
      const res = await fetch(retryUrl, { method: 'POST', body: form, headers })
      const status = res.status
      const bodyText = await res.text()
      let parsed: any = null
      try { parsed = JSON.parse(bodyText) } catch (e) { parsed = bodyText }
      upstream = { status, body: parsed }
    } catch (e: any) {
      upstream = { error: String(e?.message ?? e) }
    }

    return NextResponse.json({ tokenPayload, retryUrl, upstream })
  } catch (err: any) {
    console.error('Debug retry-test error', err)
    return NextResponse.json({ message: 'server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
