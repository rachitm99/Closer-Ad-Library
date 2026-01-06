import admin from 'firebase-admin'

let app: admin.app.App

if (!admin.apps.length) {
  // Prefer NEXT_SA_KEY JSON env; else fall back to ADC
  if (process.env.NEXT_SA_KEY) {
    try {
      const creds = JSON.parse(process.env.NEXT_SA_KEY)
      app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: creds.project_id,
          clientEmail: creds.client_email,
          privateKey: creds.private_key.replace(/\\n/g, '\n'),
        }),
      })
    } catch (e) {
      console.warn('Failed to parse NEXT_SA_KEY; falling back to default credentials', e)
      app = admin.initializeApp()
    }
  } else {
    app = admin.initializeApp()
  }
} else {
  app = admin.app()
}

export async function verifyIdToken(idToken: string) {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken)
    return decoded
  } catch (e) {
    throw e
  }
}

export async function getEmailFromAuthHeader(headers: Headers) {
  const auth = headers.get('authorization') || headers.get('Authorization')
  if (!auth) throw new Error('Missing Authorization header')
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) throw new Error('Invalid Authorization header')
  const token = m[1]
  const decoded = await verifyIdToken(token)
  return decoded.email as string | undefined
}
