import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, signInWithRedirect, getRedirectResult } from 'firebase/auth'

let authInitialized = false

function readConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  }
}

export function isFirebaseConfigured() {
  const cfg = readConfig()
  return !!(cfg.apiKey && cfg.projectId && cfg.authDomain && cfg.appId)
}

function initFirebaseClient() {
  if (authInitialized || getApps().length > 0) return
  const config = readConfig()
  console.log('[initFirebaseClient] Config read:', { ...config, apiKey: config.apiKey ? '***' : undefined })
  if (!config.projectId || !config.apiKey) {
    console.warn('[initFirebaseClient] Not configured — missing projectId or apiKey')
    return
  }
  console.log('[initFirebaseClient] Initializing Firebase app...')
  initializeApp(config as any)
  authInitialized = true
  console.log('[initFirebaseClient] Firebase initialized successfully')
}

initFirebaseClient()

export function getFirebaseAuth() {
  initFirebaseClient()
  try {
    return getAuth()
  } catch (e) {
    return null
  }
}

export async function signInWithGooglePopup() {
  const auth = getFirebaseAuth()
  if (!auth) throw new Error('Firebase not configured: set NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, and NEXT_PUBLIC_FIREBASE_APP_ID in your environment')
  const provider = new GoogleAuthProvider()
  const res = await signInWithPopup(auth, provider)
  return res
}

export async function signInWithGoogleRedirect() {
  console.log('[signInWithGoogleRedirect] Starting...')
  const auth = getFirebaseAuth()
  if (!auth) {
    console.error('[signInWithGoogleRedirect] Firebase not configured')
    throw new Error('Firebase not configured')
  }
  console.log('[signInWithGoogleRedirect] Auth object obtained', auth)
  const provider = new GoogleAuthProvider()
  // Force account selection to ensure user picks an account each time
  provider.setCustomParameters({ prompt: 'select_account' })
  console.log('[signInWithGoogleRedirect] Calling signInWithRedirect...')
  await signInWithRedirect(auth, provider)
  console.log('[signInWithGoogleRedirect] signInWithRedirect called (should redirect now)')
}

export async function handleRedirectResult(): Promise<{ token?: string | null, email?: string | null }> {
  const auth = getFirebaseAuth()
  if (!auth) return {}
  try {
    const result = await getRedirectResult(auth)
    if (result && result.user) {
      const token = await result.user.getIdToken()
      return { token, email: result.user.email ?? null }
    }
    return {}
  } catch (e) {
    return {}
  }
}

export async function signOutFirebase() {
  const auth = getFirebaseAuth()
  if (!auth) return
  await fbSignOut(auth)
}

export async function getIdToken(): Promise<string | null> {
  const auth = getFirebaseAuth()
  if (!auth || !auth.currentUser) return null
  return await auth.currentUser.getIdToken(true)
}

export function getCurrentUserEmail(): string | null {
  const auth = getFirebaseAuth()
  if (!auth || !auth.currentUser) return null
  return auth.currentUser.email ?? null
}
