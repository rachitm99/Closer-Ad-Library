import { GoogleAuth } from 'google-auth-library'

/**
 * Obtain an IdTokenClient for the given audience (Cloud Run URL).
 * Uses Application Default Credentials (ADC). If ADC not available and
 * NEXT_SA_KEY env var is provided (JSON), the helper will create credentials
 * from that service account key.
 */
export async function getIdTokenClient(audience: string) {
  const opts: any = {}
  const saKey = process.env.NEXT_SA_KEY
  if (saKey) {
    try {
      const credentials = JSON.parse(saKey)
      opts.credentials = credentials
      console.log('[getIdToken] Using service account:', credentials.client_email || 'unknown')
    } catch (err) {
      console.warn('[getIdToken] NEXT_SA_KEY present but failed to parse JSON; ignoring', err)
    }
  } else {
    console.log('[getIdToken] No NEXT_SA_KEY found, using ADC')
  }

  try {
    const auth = new GoogleAuth(opts)
    console.log('[getIdToken] Creating ID token client for audience:', audience)
    // getIdTokenClient returns a client that will attach an ID token for the given audience
    const client = await auth.getIdTokenClient(audience)
    console.log('[getIdToken] ID token client created successfully')
    return client
  } catch (err: any) {
    console.error('[getIdToken] Failed to create ID token client:', err)
    console.error('[getIdToken] Error details:', {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      response: err?.response?.data
    })
    throw err
  }
}
