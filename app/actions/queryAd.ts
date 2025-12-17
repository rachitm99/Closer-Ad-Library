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
export async function queryAdWithGcs(gcsPath: string, pageId?: string): Promise<CloudRunResponse> {
  if (!process.env.CLOUD_RUN_URL) throw new Error('CLOUD_RUN_URL not configured')
  const audience = process.env.CLOUD_RUN_URL
  const client = await getIdTokenClient(audience)
  const authHeaders = await client.getRequestHeaders()

  // extract token header
  let authValue: string | null = null
  if (typeof authHeaders === 'string') authValue = authHeaders
  else if ('authorization' in (authHeaders as any)) authValue = (authHeaders as any).authorization

  if (!authValue) throw new Error('Failed to obtain ID token')

  const upstreamUrl = `${audience.replace(/\/$/, '')}/query`

  const form = new (global as any).FormData()
  form.append('video_url', gcsPath)
  if (pageId) form.append('page_id', pageId)

  let lastErr: any = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { Authorization: authValue },
        body: form as any,
      })
      if (!res.ok) {
        if (res.status >= 500) {
          lastErr = new Error(`Upstream ${res.status}`)
          const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
          await sleep(backoff)
          continue
        }
        const text = await res.text()
        throw new Error(`Upstream error: ${res.status} ${text}`)
      }
      const data = (await res.json()) as CloudRunResponse
      return { results: (data.results || []).slice(0, 10) }
    } catch (err: any) {
      lastErr = err
      const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100)
      await sleep(backoff)
      continue
    }
  }
  throw new Error(`Failed to query upstream: ${lastErr?.message || String(lastErr)}`)
}
