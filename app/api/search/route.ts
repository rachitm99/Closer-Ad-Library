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
    // Request raw text to avoid client-side JSON parsing errors from upstream
    const res = await client.request({ url: target, method: 'GET', responseType: 'text' } as any)
    if (!res) return NextResponse.json({ message: 'No response from upstream' }, { status: 502 })
    const statusRaw = res.status as number | string | undefined
    const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
    const text = typeof res.data === 'string' ? res.data : String(res.data ?? '')

    if (Number.isNaN(status) || status < 200 || status >= 300) {
      console.error('Upstream returned non-2xx status', { status, bodyPreview: text.slice(0, 1000) })
      return NextResponse.json({ message: 'Upstream error', details: text.length > 1000 ? text.slice(0, 1000) + '...' : text }, { status: 502 })
    }

    // Try to parse JSON ourselves so we can provide a helpful error message when parsing fails
    try {
      const parsed = JSON.parse(text)
      // If upstream signals an error in the JSON payload, surface it
      if (parsed && (parsed.error || parsed.success === false || parsed.message)) {
        console.error('Upstream returned an error payload', { payloadPreview: JSON.stringify(parsed).slice(0, 1000) })
        return NextResponse.json({ message: 'Upstream returned an error', details: parsed }, { status: 502 })
      }
      return NextResponse.json(parsed)
    } catch (parseErr: any) {
      console.warn('Initial JSON.parse failed, attempting tolerant extraction', { err: String(parseErr?.message ?? parseErr), bodyPreview: text.slice(0, 2000) })
      // Try to handle double-encoded JSON ("{...}") or JSON wrapped in other text like HTML
      try {
        // If the response is a JSON string encoded as a string value, parse twice
        const maybe = JSON.parse(text)
        if (typeof maybe === 'string') {
          try {
            const inner = JSON.parse(maybe)
            return NextResponse.json(inner)
          } catch (_) {
            // fall through
          }
        }
      } catch (_) {
        // ignore
      }

      // Try to extract first {...} or [...]
      const objMatch = text.match(/(\{[\s\S]*\})/)
      const arrMatch = text.match(/(\[[\s\S]*\])/)
      const candidate = objMatch ? objMatch[1] : arrMatch ? arrMatch[1] : null
      if (candidate) {
        try {
          const parsed = JSON.parse(candidate)
          if (parsed && (parsed.error || parsed.success === false || parsed.message)) {
            console.error('Upstream returned an error payload after extraction', { payloadPreview: JSON.stringify(parsed).slice(0, 1000) })
            return NextResponse.json({ message: 'Upstream returned an error', details: parsed }, { status: 502 })
          }
          return NextResponse.json(parsed)
        } catch (e: any) {
          console.error('Extraction JSON.parse failed', { err: String(e?.message ?? e), candidatePreview: candidate.slice(0, 2000) })
          return NextResponse.json({ message: 'Upstream returned invalid JSON', details: candidate.length > 2000 ? candidate.slice(0, 2000) + '...' : candidate }, { status: 502 })
        }
      }

      // As a last resort, return the raw text for debugging
      return NextResponse.json({ message: 'Upstream returned invalid JSON', details: text.length > 2000 ? text.slice(0, 2000) + '...' : text }, { status: 502 })
    }
  } catch (err: any) {
    console.error('Error in /api/search', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
