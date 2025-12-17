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
      opts.credentials = JSON.parse(saKey)
    } catch (err) {
      console.warn('NEXT_SA_KEY present but failed to parse JSON; ignoring')
    }
  }

  const auth = new GoogleAuth(opts)
  // getIdTokenClient returns a client that will attach an ID token for the given audience
  return auth.getIdTokenClient(audience)
}
