import fs from 'fs/promises'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = (typeof params === 'object' && 'then' in params) ? await params as { id: string } : params as { id: string }
    if (!id) return new Response(JSON.stringify({ message: 'Missing ad ID' }), { status: 400 })

    const useMockEnv = (process.env.USE_MOCK || 'false') === 'true'
    const rapidApiKey = process.env.RAPIDAPI_KEY || null
    const rapidApiHost = 'facebook-ads-library-scraper-api.p.rapidapi.com'

    let adInfo: any = null

    if (!rapidApiKey) {
      if (useMockEnv) {
        try {
          const adJsonPath = new URL('../../../../ad_info.json', import.meta.url).pathname
          const rawAd = await fs.readFile(adJsonPath, 'utf8')
          adInfo = JSON.parse(rawAd)
        } catch (err) {
          console.error('Failed to read ad_info.json mock', err)
        }
      } else {
        console.log('No RAPIDAPI_KEY configured; cannot fetch remote ad info')
      }
    } else {
      const adEndpoint = `https://${rapidApiHost}/ad?trim=false&get_transcript=false&id=${encodeURIComponent(id)}`
      
      console.log('[ad/[id]] Making RapidAPI request:')
      console.log('  URL:', adEndpoint)
      console.log('  Headers:', {
        'x-rapidapi-host': rapidApiHost,
        'x-rapidapi-key': `${rapidApiKey?.substring(0, 8)}...` // Only show first 8 chars for security
      })
      console.log('  Ad ID:', id)
      
      const adResp = await fetch(adEndpoint, {
        method: 'GET',
        headers: {
          'x-rapidapi-host': rapidApiHost,
          'x-rapidapi-key': rapidApiKey,
        },
      })
      
      console.log('[ad/[id]] RapidAPI response received:')
      console.log('  Status:', adResp.status)
      console.log('  Status Text:', adResp.statusText)
      console.log('  Headers:', Object.fromEntries(adResp.headers.entries()))
      
      if (!adResp.ok) {
        const txt = await adResp.text()
        console.error('[ad/[id]] RapidAPI ad fetch error')
        console.error('  Request URL:', adEndpoint)
        console.error('  Request Ad ID:', id)
        console.error('  Response Status:', adResp.status)
        console.error('  Response Body:', txt)
        console.error('  Parsed Body:', (() => {
          try { return JSON.parse(txt) } catch { return 'Not valid JSON' }
        })())
      } else {
        const txt = await adResp.text()
        console.log('[ad/[id]] Raw response body:', txt.substring(0, 1000))
        try {
          adInfo = JSON.parse(txt)
          console.log('[ad/[id]] Parsed ad info successfully')
        } catch (parseErr) {
          console.error('[ad/[id]] Failed to parse response as JSON:', parseErr)
        }
      }
    }

    return new Response(JSON.stringify({ adInfo }), { status: 200 })
  } catch (err: any) {
    console.error('GET /api/ad/[id] error', err)
    return new Response(JSON.stringify({ message: 'Internal Server Error', details: err?.message }), { status: 500 })
  }
}
