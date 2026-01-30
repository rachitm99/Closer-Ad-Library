"use client"
import React, { useEffect, useState } from 'react'
import { getFirebaseAuth, signOutFirebase } from '../lib/firebaseClient'

export default function AuthButton(): React.ReactElement | null {
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    let unsub: (() => void) | null = null
    
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

      // Check for existing session first
      try {
        const sessionRes = await fetch('/api/auth/session', { credentials: 'same-origin' })
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          if (mounted && sessionData?.email) {
            setEmail(sessionData.email)
            setLoading(false)
            return
          }
        }
      } catch (e) {
        console.warn('[AuthButton] Session check failed:', e)
      }

      // Set up Firebase auth listener
      unsub = auth.onAuthStateChanged(async (user) => {
        if (!mounted) return
        if (user) {
          setEmail(user.email ?? null)
        } else {
          setEmail(null)
        }
        setLoading(false)
      })
    }
    
    init()
    
    return () => { 
      mounted = false
      if (unsub) unsub()
    }
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
    console.log('[AuthButton] Sign in clicked')
    setError(null)
    setLoading(true)
    try {
      const m = await import('../lib/firebaseClient')
      const result = await m.signInWithGoogle()
      console.log('[AuthButton] Sign in completed:', result)
      
      // For popup flow (localhost), we get the result immediately
      if (result?.user) {
        const idToken = await result.user.getIdToken()
        console.log('[AuthButton] Got ID token, creating session...')
        const r = await fetch('/api/auth/session', { 
          method: 'POST', 
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, 
          body: JSON.stringify({ idToken }) 
        })
        if (r.ok) {
          console.log('[AuthButton] Session created, reloading...')
          window.location.href = '/'
        } else {
          const txt = await r.text()
          console.error('[AuthButton] Session creation failed:', txt)
          setError('Failed to create session: ' + txt)
        }
      }
      // For redirect flow (production), the page will redirect away
    } catch (e: any) {
      console.error('[AuthButton] Sign in error:', e)
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
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
