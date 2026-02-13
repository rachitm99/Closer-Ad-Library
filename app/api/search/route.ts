import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../lib/getIdToken'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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
    const target = `${searchUrl}${searchUrl.includes('?') ? '&' : '?'}query=${encodeURIComponent(q)}`

    let lastError: any = null

    // Retry loop
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[search] Attempt ${attempt}/${MAX_RETRIES} for query: ${q}`)
        
        // Request raw text to avoid client-side JSON parsing errors from upstream
        const res = await client.request({ url: target, method: 'GET', responseType: 'text' } as any)
        if (!res) {
          lastError = new Error('No response from upstream')
          if (attempt < MAX_RETRIES) {
            console.warn(`[search] No response, retrying in ${RETRY_DELAY_MS}ms...`)
            await sleep(RETRY_DELAY_MS * attempt)
            continue
          }
          break
        }
        
        const statusRaw = res.status as number | string | undefined
        const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
        const text = typeof res.data === 'string' ? res.data : String(res.data ?? '')

        if (Number.isNaN(status) || status < 200 || status >= 300) {
          console.error(`[search] Upstream returned non-2xx status: ${status}`, { bodyPreview: text.slice(0, 1000) })
          lastError = { status, text }
          
          // Only retry on 5xx errors, not 4xx
          if (status >= 500 && attempt < MAX_RETRIES) {
            console.warn(`[search] Server error, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
            await sleep(RETRY_DELAY_MS * attempt)
            continue
          }
          
          return NextResponse.json({ message: 'Upstream error', details: text.length > 1000 ? text.slice(0, 1000) + '...' : text }, { status: 502 })
        }

        // Try to parse JSON ourselves so we can provide a helpful error message when parsing fails
        try {
          const parsed = JSON.parse(text)
          console.log('[search] Parsed upstream response:', JSON.stringify(parsed, null, 2).substring(0, 500))
          
          // If upstream signals an error in the JSON payload, check if we should retry
          if (parsed && (parsed.error || parsed.success === false)) {
            console.error(`[search] Upstream returned an error payload`, { payloadPreview: JSON.stringify(parsed).slice(0, 1000) })
            lastError = parsed
            
            // Retry on upstream errors if we haven't exhausted attempts
            if (attempt < MAX_RETRIES) {
              console.warn(`[search] Upstream error, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
              await sleep(RETRY_DELAY_MS * attempt)
              continue
            }
            
            // Return the upstream error directly after exhausting retries
            return NextResponse.json(parsed, { status: parsed.status || 502 })
          }
          
          // Success - return the parsed response
          return NextResponse.json(parsed)
        } catch (parseErr: any) {
          console.warn('[search] Initial JSON.parse failed, attempting tolerant extraction', { err: String(parseErr?.message ?? parseErr), bodyPreview: text.slice(0, 2000) })
          lastError = parseErr
          
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
                console.error('[search] Upstream returned an error payload after extraction', { payloadPreview: JSON.stringify(parsed).slice(0, 1000) })
                
                // Retry on upstream errors if we haven't exhausted attempts
                if (attempt < MAX_RETRIES) {
                  console.warn(`[search] Upstream error after extraction, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
                  await sleep(RETRY_DELAY_MS * attempt)
                  continue
                }
                
                return NextResponse.json(parsed, { status: parsed.status || 502 })
              }
              return NextResponse.json(parsed)
            } catch (e: any) {
              console.error('[search] Extraction JSON.parse failed', { err: String(e?.message ?? e), candidatePreview: candidate.slice(0, 2000) })
              
              // Retry on parse errors if we haven't exhausted attempts
              if (attempt < MAX_RETRIES) {
                console.warn(`[search] Parse error, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
                await sleep(RETRY_DELAY_MS * attempt)
                continue
              }
              
              return NextResponse.json({ message: 'Upstream returned invalid JSON', details: candidate.length > 2000 ? candidate.slice(0, 2000) + '...' : candidate }, { status: 502 })
            }
          }

          // Retry if we haven't exhausted attempts
          if (attempt < MAX_RETRIES) {
            console.warn(`[search] Could not parse response, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
            await sleep(RETRY_DELAY_MS * attempt)
            continue
          }
          
          // As a last resort, return the raw text for debugging
          return NextResponse.json({ message: 'Upstream returned invalid JSON', details: text.length > 2000 ? text.slice(0, 2000) + '...' : text }, { status: 502 })
        }
      } catch (attemptErr: any) {
        lastError = attemptErr
        console.error(`[search] Attempt ${attempt} failed:`, attemptErr)
        
        // Retry on request errors
        if (attempt < MAX_RETRIES) {
          console.warn(`[search] Request error, retrying in ${RETRY_DELAY_MS * attempt}ms...`)
          await sleep(RETRY_DELAY_MS * attempt)
          continue
        }
      }
    }

    // If we get here, all retries failed
    console.error('[search] All retry attempts exhausted')
    return NextResponse.json({ 
      message: 'Search failed after multiple attempts', 
      details: lastError?.message || String(lastError) 
    }, { status: 502 })
  } catch (err: any) {
    console.error('Error in /api/search', err)
    return NextResponse.json({ message: 'Server error', details: String(err?.message ?? err) }, { status: 500 })
  }
}
