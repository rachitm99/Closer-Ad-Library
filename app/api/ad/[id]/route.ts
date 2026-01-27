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
      const adResp = await fetch(adEndpoint, {
        method: 'GET',
        headers: {
          'x-rapidapi-host': rapidApiHost,
          'x-rapidapi-key': rapidApiKey,
        },
      })
      if (!adResp.ok) {
        const txt = await adResp.text()
        console.error('RapidAPI ad fetch error', { status: adResp.status, body: txt })
      } else {
        adInfo = await adResp.json()
      }
    }

    return new Response(JSON.stringify({ adInfo }), { status: 200 })
  } catch (err: any) {
    console.error('GET /api/ad/[id] error', err)
    return new Response(JSON.stringify({ message: 'Internal Server Error', details: err?.message }), { status: 500 })
  }
}
