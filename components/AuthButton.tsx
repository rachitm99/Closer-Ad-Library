"use client"
import React, { useEffect, useState } from 'react'
import { getFirebaseAuth, signInWithGoogleRedirect, signOutFirebase } from '../lib/firebaseClient'

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
      // use redirect flow to avoid popup/COOP issues
      await signInWithGoogleRedirect()
      // the redirect will navigate away; post-redirect handling is done on /login
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
        <div className="text-sm text-gray-600">You will be redirected to Google to select an account.</div>
        <button onClick={onSignIn} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm">Sign in with Google</button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm text-gray-700">Signed in as <strong>{email}</strong></div>
      <button onClick={() => onSignOut()} className="px-3 py-1 border rounded text-sm">Sign out</button>
    </div>
  )
}
