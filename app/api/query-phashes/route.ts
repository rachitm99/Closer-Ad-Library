import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../lib/getIdToken'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const phashes = body.phashes
    const pageId = body.pageId
    const days = body.days
    const lastRefreshed = body.last_refreshed

    if (!phashes) {
      return NextResponse.json({ message: 'Missing phashes' }, { status: 400 })
    }

    // Call the Cloud Run service with phashes using authenticated client
    // Your GCP /search endpoint expects POST with JSON body
    const searchUrl = process.env.CLOUD_RUN_URL || 'https://your-service.run.app'
    const audience = process.env.CLOUD_RUN_URL || searchUrl
    
    console.log('[query-phashes] Calling Cloud Run URL:', searchUrl)
    console.log('[query-phashes] Audience:', audience)
    console.log('[query-phashes] Request body:', { phashes: phashes?.length, pageId, lastRefreshed })
    
    try {
      const client = await getIdTokenClient(audience)
      console.log('[query-phashes] ID token client obtained successfully')
      
      // Build request body
      const requestBody: any = {
        phashes,
        page_id: pageId
      }
      
      // TODO: Add date filter once GCP service has python-dateutil installed
      // Add date in ISO format if lastRefreshed is available
      // if (lastRefreshed) {
      //   requestBody.date = new Date(lastRefreshed).toISOString()
      //   console.log('[query-phashes] Including date filter:', requestBody.date)
      // }
      
      console.log('[query-phashes] Making request to:', `${searchUrl}/search`)
      
      const res = await client.request({
        url: `${searchUrl}/search`,
        method: 'POST',
        data: requestBody,
        headers: { 'Content-Type': 'application/json' }
      } as any)

      console.log('[query-phashes] Response status:', res?.status)
      
      if (!res || res.status < 200 || res.status >= 300) {
        const errorText = res?.data ? JSON.stringify(res.data) : 'No response'
        console.error('[query-phashes] Cloud Run error:', errorText)
        return NextResponse.json(
          { message: 'Cloud Run query failed', details: errorText },
          { status: res?.status || 500 }
        )
      }

      return NextResponse.json(res.data)
    } catch (authErr: any) {
      console.error('[query-phashes] Auth error:', authErr)
      console.error('[query-phashes] Auth error details:', {
        message: authErr?.message,
        code: authErr?.code,
        status: authErr?.status,
        config: authErr?.config,
        response: authErr?.response?.data
      })
      return NextResponse.json(
        { message: 'Authentication failed', details: authErr?.message || String(authErr) },
        { status: 500 }
      )
    }
  } catch (err: any) {
    console.error('[query-phashes] Error:', err)
    return NextResponse.json(
      { message: 'Server error', details: String(err?.message ?? err) },
      { status: 500 }
    )
  }
}
