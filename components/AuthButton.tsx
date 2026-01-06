"use client"
import React, { useEffect, useState } from 'react'
import { getFirebaseAuth, signInWithGooglePopup, signOutFirebase, getIdToken, getCurrentUserEmail } from '../lib/firebaseClient'

export default function AuthButton(): React.ReactElement | null {
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) {
      setLoading(false)
      return
    }
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) setEmail(user.email ?? null)
      else setEmail(null)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  if (loading) return null

  if (!email) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => signInWithGooglePopup()} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm">Sign in with Google</button>
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
