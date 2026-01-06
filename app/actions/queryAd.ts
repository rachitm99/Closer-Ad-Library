import { getIdTokenClient } from '../../lib/getIdToken'

export type CloudRunResult = {
  video_id: string
  ad_url?: string
  avg_similarity: number
  max_similarity: number
  matches_count: number
}

export type CloudRunResponse = { results: CloudRunResult[] }

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 500

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Server action to invoke Cloud Run /query with a GCS path
 */
export async function queryAdWithGcs(gcsPath: string, pageId?: string, uid?: string): Promise<CloudRunResponse> {
  if (!process.env.CLOUD_RUN_URL) throw new Error('CLOUD_RUN_URL not configured')
  const audience = process.env.CLOUD_RUN_URL
  const client = await getIdTokenClient(audience)
  const upstreamUrl = `${audience.replace(/\/$/, '')}/query`

  const form = new (global as any).FormData()
  form.append('video_url', gcsPath)
  if (pageId) form.append('page_id', pageId)
  if (uid) form.append('uid', uid)

  let lastErr: any = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Use the IdTokenClient.request helper so the client can attach the ID token
      // and handle auth nuances across environments (ADC or NEXT_SA_KEY).
      const res = await client.request({
        url: upstreamUrl,
        method: 'POST',
        data: form as any,
      } as any)

      if (!res) {
        lastErr = new Error('No response from upstream')
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
        await sleep(backoff)
        continue
      }

      const statusRaw = res.status as number | string | undefined
      const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
      if (Number.isNaN(status) || status < 200 || status >= 300) {
        if (!Number.isNaN(status) && status >= 500) {
          lastErr = new Error(`Upstream ${status}`)
          const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
          await sleep(backoff)
          continue
        }
        const text = res?.data ? JSON.stringify(res.data) : 'no response body'
        const statusText = Number.isNaN(status) ? 'unknown' : String(status)
        throw new Error(`Upstream error: ${statusText} ${text}`)
      }

      const data = (res.data || {}) as CloudRunResponse
      return { results: (data.results || []) }
    } catch (err: any) {
      lastErr = err
      // If the underlying error indicates missing credentials, throw immediately with a helpful message
      const msg = String(err?.message || '')
      if (msg.includes('Could not load the default credentials') || msg.includes('Failed to obtain')) {
        throw new Error('Failed to obtain ID token: ensure ADC is configured or set NEXT_SA_KEY on the server')
      }
      const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
      await sleep(backoff)
      continue
    }
  }
  throw new Error(`Failed to query upstream: ${lastErr?.message || String(lastErr)}`)
}
