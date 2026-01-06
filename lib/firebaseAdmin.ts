import admin from 'firebase-admin'

let app: admin.app.App

if (!admin.apps.length) {
  // Prefer NEXT_SA_KEY JSON env; else fall back to ADC
  if (process.env.NEXT_SA_KEY) {
    try {
      const creds = JSON.parse(process.env.NEXT_SA_KEY)
      console.log('[firebaseAdmin] Initializing with service account:', creds.client_email)
      app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: creds.project_id,
          clientEmail: creds.client_email,
          privateKey: creds.private_key.replace(/\\n/g, '\n'),
        }),
        projectId: creds.project_id,
      })
      console.log('[firebaseAdmin] Admin SDK initialized successfully')
    } catch (e) {
      console.error('Failed to parse NEXT_SA_KEY; falling back to default credentials', e)
      app = admin.initializeApp()
    }
  } else {
    console.log('[firebaseAdmin] No NEXT_SA_KEY, using default credentials')
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

export async function createSessionCookie(idToken: string, expiresIn = 5 * 24 * 60 * 60 * 1000) {
  // expiresIn in ms; default 5 days
  try {
    const cookie = await admin.auth().createSessionCookie(idToken, { expiresIn })
    return cookie
  } catch (e) {
    throw e
  }
}

export async function verifySessionCookie(sessionCookie: string) {
  try {
    const decoded = await admin.auth().verifySessionCookie(sessionCookie, true)
    return decoded
  } catch (e) {
    throw e
  }
}

export async function getEmailFromAuthHeader(headers: Headers) {
  // First check Authorization header for Bearer ID token
  const auth = headers.get('authorization') || headers.get('Authorization')
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i)
    if (m) {
      const token = m[1]
      const decoded = await verifyIdToken(token)
      return decoded.email as string | undefined
    }
  }

  // Fallback: check session cookie 'fb_session'
  const cookie = headers.get('cookie') || ''
  const sessionMatch = cookie.match(/(?:^|; )fb_session=([^;]+)/)
  if (sessionMatch) {
    const sessionCookie = decodeURIComponent(sessionMatch[1])
    const decoded = await verifySessionCookie(sessionCookie)
    return decoded.email as string | undefined
  }

  return undefined
}

export async function getUidFromAuthHeader(headers: Headers) {
  // First check Authorization header for Bearer ID token
  const auth = headers.get('authorization') || headers.get('Authorization')
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i)
    if (m) {
      const token = m[1]
      const decoded = await verifyIdToken(token)
      return decoded.uid as string
    }
  }

  // Fallback: check session cookie 'fb_session'
  const cookie = headers.get('cookie') || ''
  const sessionMatch = cookie.match(/(?:^|; )fb_session=([^;]+)/)
  if (sessionMatch) {
    const sessionCookie = decodeURIComponent(sessionMatch[1])
    const decoded = await verifySessionCookie(sessionCookie)
    return decoded.uid as string
  }

  throw new Error('No auth token or session cookie found')
}
