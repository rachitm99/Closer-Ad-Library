import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../lib/getIdToken'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = url.searchParams.get('query') || url.searchParams.get('q')
    if (!q) return NextResponse.json({ message: 'Missing query parameter' }, { status: 400 })

    // Prefer an explicit BRAND_FETCHER_URL if set, otherwise fall back to old search URL
    const searchUrl = process.env.BRAND_FETCHER_URL || process.env.CLOUD_RUN_SEARCH_URL || 'https://brands-face-query-prod-810614481902.us-central1.run.app/search'
    // Audience override: BRAND_FETCHER_AUDIENCE takes precedence, otherwise infer from URL origin
    const audience = process.env.BRAND_FETCHER_AUDIENCE || process.env.CLOUD_RUN_SEARCH_AUDIENCE || new URL(searchUrl).origin
    console.info('Using search URL:', searchUrl, 'audience:', audience)

    const client = await getIdTokenClient(audience)

    // Forward the GET with the query param to the brand fetcher service
    const target = `${searchUrl}${searchUrl.includes('?') ? '&' : '?'}query=${encodeURIComponent(q)}`
    const res = await client.request({ url: target, method: 'GET' } as any)
    if (!res) return NextResponse.json({ message: 'No response from upstream' }, { status: 502 })
    const statusRaw = res.status as number | string | undefined
    const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
    if (Number.isNaN(status) || status < 200 || status >= 300) {
      return NextResponse.json({ message: 'Upstream error', details: res?.data ?? res?.status }, { status: 502 })
    }

    return NextResponse.json(res.data)
  } catch (err: any) {
    console.error('Error in /api/search', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
