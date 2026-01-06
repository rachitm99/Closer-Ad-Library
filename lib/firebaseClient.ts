import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from 'firebase/auth'

let authInitialized = false

function initFirebaseClient() {
  if (authInitialized || getApps().length > 0) return
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  }
  if (!config.projectId) {
    // Silent: allow running without config in non-auth environments
    return
  }
  initializeApp(config as any)
  authInitialized = true
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
  if (!auth) throw new Error('Firebase not configured')
  const provider = new GoogleAuthProvider()
  const res = await signInWithPopup(auth, provider)
  return res
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
