"use client"
import React, { useEffect, useState } from 'react'
import { getFirebaseAuth, signInWithGooglePopup, signOutFirebase, getIdToken, getCurrentUserEmail } from '../lib/firebaseClient'

export default function AuthButton(): React.ReactElement | null {
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function init() {
      const auth = getFirebaseAuth()
      try {
        const m = await import('../lib/firebaseClient')
        if (mounted) setIsConfigured(m.isFirebaseConfigured())
      } catch (e) {
        if (mounted) setIsConfigured(false)
      }

      if (!auth) {
        if (mounted) setLoading(false)
        return
      }
      const unsub = auth.onAuthStateChanged((user) => {
        if (!mounted) return
        if (user) setEmail(user.email ?? null)
        else setEmail(null)
        setLoading(false)
      })
      return () => { mounted = false; unsub() }
    }
    const res = init()
    return () => { /* cleanup handled in init's returned function */ }
  }, [])

  if (loading) return null

  if (isConfigured === false) {
    return (
      <div className="flex items-center gap-2">
        <div className="text-sm text-red-600">Firebase not configured. Set <code>NEXT_PUBLIC_FIREBASE_API_KEY</code> and <code>NEXT_PUBLIC_FIREBASE_PROJECT_ID</code> in <code>.env.local</code>.</div>
      </div>
    )
  }

  const onSignIn = async () => {
    setError(null)
    try {
      await signInWithGooglePopup()
      const token = await getIdToken()
      if (token) {
        // create session cookie on server
        const res = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }) })
        if (!res.ok) throw new Error('Failed to create session')
        // reload to let middleware pick up cookie
        window.location.reload()
      }
    } catch (e: any) {
      setError(String(e?.message ?? e))
    }
  }

  const onSignOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' })
    await signOutFirebase()
    window.location.reload()
  }

  if (!email) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onSignIn} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm">Sign in with Google</button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm text-gray-700">Signed in as <strong>{email}</strong></div>
      <button onClick={() => signOutFirebase()} className="px-3 py-1 border rounded text-sm">Sign out</button>
    </div>
  )
}
