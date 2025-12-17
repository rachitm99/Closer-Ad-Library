import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../lib/getIdToken'

export const config = {
  api: {
    bodyParser: false,
  },
}

// Types for response (top-level exported)
export type CloudRunResult = {
  video_id: string
  ad_url?: string
  avg_similarity: number
  max_similarity: number
  matches_count: number
}

export type CloudRunResponse = {
  results: CloudRunResult[]
}

// Limit file size to e.g., 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB (adjust as needed)


// We implement a simple parser using form-data from the Request
// As Next.js Request exposes formData, prefer that when available
async function parseFormData(req: Request) {
  // Node 18 fetch Request supports formData()
  const fd = await (req as any).formData()
  const fields: Record<string, any> = {}
  const files: Record<string, any> = {}

  for (const [key, value] of fd.entries()) {
    if (value instanceof File) {
      files[key] = value
    } else {
      fields[key] = value
    }
  }
  return { files, fields }
}

async function getFileBuffer(file: File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function POST(request: Request) {
  try {
    if (!process.env.CLOUD_RUN_URL) {
      return NextResponse.json({ message: 'Server misconfigured: CLOUD_RUN_URL not set' }, { status: 500 })
    }

    // Parse incoming multipart/form-data
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ message: 'Content-Type must be multipart/form-data' }, { status: 400 })
    }

    const { files, fields } = await parseFormData(request)

    const file = files['file']
    const pageId = fields['page_id'] || fields['pageId']

    if (!file) {
      return NextResponse.json({ message: 'Missing file field' }, { status: 400 })
    }
    if (!pageId) {
      return NextResponse.json({ message: 'Missing page_id field' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ message: `File too large. Max is ${MAX_FILE_SIZE} bytes` }, { status: 413 })
    }

    // Prepare form-data for Cloud Run
    const form = new (global as any).FormData()
    const buffer = await getFileBuffer(file as File)
    // Use a file name if available
    form.append('file', new Blob([buffer]), (file as any).name || 'upload.mp4')
    form.append('page_id', String(pageId))

    // Obtain ID token client for Cloud Run
    const audience = process.env.CLOUD_RUN_URL as string
    const client = await getIdTokenClient(audience)

    // The IdTokenClient exposes a request method which adds Authorization header
    // Use client.request to forward the multipart request
    // Note: client.request uses gaxios and can accept a FormData body data

    // Obtain authorization headers (ID token) and forward using fetch
    const authHeaders = await client.getRequestHeaders()
    const upstreamUrl = `${audience.replace(/\/$/, '')}/query`

    // Retry configuration
    const MAX_ATTEMPTS = 3
    const BASE_DELAY_MS = 500

    async function sleep(ms: number) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    let lastErr: any = null
    let upstreamResp: Response | null = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        upstreamResp = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            Authorization: authHeaders.authorization,
            // Do NOT set content-type: fetch will set multipart boundary
          },
          body: form as any,
        })

        // If OK, break and process
        if (upstreamResp.ok) break

        // For 5xx responses, consider retrying
        if (upstreamResp.status >= 500 && upstreamResp.status < 600) {
          lastErr = new Error(`Upstream returned ${upstreamResp.status}`)
          const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
          await sleep(backoff)
          continue
        }

        // For other non-OK statuses, do not retry
        const text = await upstreamResp.text()
        return NextResponse.json({ message: 'Upstream returned non-200', details: text }, { status: upstreamResp.status })
      } catch (err: any) {
        // Network or transient error — retry
        lastErr = err
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
        await sleep(backoff)
        continue
      }
    }

    if (!upstreamResp) {
      return NextResponse.json({ message: 'Failed to reach upstream', details: String(lastErr) }, { status: 502 })
    }

    if (!upstreamResp.ok) {
      const text = await upstreamResp.text()
      return NextResponse.json({ message: 'Upstream failed after retries', details: text }, { status: upstreamResp.status || 502 })
    }

    const data = (await upstreamResp.json()) as CloudRunResponse
    // Return top 10 results only
    const sliced = { results: (data.results || []).slice(0, 10) }
    return NextResponse.json(sliced)
  } catch (err: any) {
    console.error('Error in /api/query POST:', err)
    return NextResponse.json({ message: 'Server error', details: err?.message || String(err) }, { status: 500 })
  }
}
