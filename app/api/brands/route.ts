import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../lib/getIdToken'

type BrandPayload = {
  name?: string
  page_id?: string
  ig_username?: string | null
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as BrandPayload
    if (!body?.name && !body?.page_id) {
      return NextResponse.json({ message: 'Missing brand name or page_id' }, { status: 400 })
    }

    const brandsUrl = process.env.BRAND_FETCHER_URL || process.env.CLOUD_RUN_SEARCH_URL || 'https://brands-face-query-prod-810614481902.us-central1.run.app/search'
    // If BRAND_FETCHER_URL points to /search path, replace with /brands
    const base = brandsUrl.replace(/\/search\/?$/i, '')
    const target = `${base}/brands`

    const audience = process.env.BRAND_FETCHER_AUDIENCE || new URL(target).origin
    const client = await getIdTokenClient(audience)

    const res = await client.request({ url: target, method: 'POST', data: body } as any)
    
    if (!res) return NextResponse.json({ message: 'No response from upstream' }, { status: 502 })
    const statusRaw = res.status as number | string | undefined
    const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
    if (Number.isNaN(status) || status < 200 || status >= 300) {
      return NextResponse.json({ message: 'Upstream error', details: res?.data ?? res?.status }, { status: 502 })
    }
    return NextResponse.json(res.data)
  } catch (err: any) {
    console.error('Error in /api/brands', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  // For convenience, forward to underlying search implementation
  try {
    const url = new URL(request.url)
    const q = url.searchParams.get('query') || url.searchParams.get('q')
    if (!q) return NextResponse.json({ message: 'Missing query parameter' }, { status: 400 })

    const searchUrl = process.env.BRAND_FETCHER_URL || process.env.CLOUD_RUN_SEARCH_URL || 'https://brands-face-query-prod-810614481902.us-central1.run.app/search'
    const audience = process.env.BRAND_FETCHER_AUDIENCE || new URL(searchUrl).origin
    const client = await getIdTokenClient(audience)
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
    console.error('Error in /api/brands GET', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
