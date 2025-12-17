import { NextResponse } from 'next/server'
import { queryAdWithGcs } from '../../actions/queryAd'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const gcsPath = body?.gcsPath
    const pageId = body?.pageId
    if (!gcsPath) return NextResponse.json({ message: 'Missing gcsPath' }, { status: 400 })

    const res = await queryAdWithGcs(gcsPath, pageId)
    return NextResponse.json(res)
  } catch (err: any) {
    console.error('Error in /api/query-gcs', err)
    return NextResponse.json({ message: 'Server error', details: err?.message || String(err) }, { status: 500 })
  }
}
