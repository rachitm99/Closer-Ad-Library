"use client"
import React, { useEffect, useState } from 'react'
import AuthButton from '../../components/AuthButton'

export default function LoginPage(): React.ReactElement {
  const [processing, setProcessing] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const m = await import('../../lib/firebaseClient')
        const { handleRedirectResult } = m
        const res = await handleRedirectResult()
        if (res?.token) {
          // exchange token for session cookie
          const r = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: res.token }) })
          if (!r.ok) {
            const txt = await r.text()
            if (mounted) setMessage(`Failed to create session: ${txt}`)
          } else {
            // redirect to home
            window.location.href = '/'
          }
        }
      } catch (e: any) {
        if (mounted) setMessage(String(e?.message ?? e))
      } finally {
        if (mounted) setProcessing(false)
      }
    })()
    return () => { mounted = false }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-indigo-50">
      <div className="bg-white p-8 rounded shadow text-center">
        <h1 className="text-xl font-semibold mb-4">Sign in</h1>
        <p className="text-sm text-gray-600 mb-4">You must sign in to access this site.</p>
        <AuthButton />
        {processing && <div className="mt-3 text-sm text-gray-500">Processing sign-in…</div>}
        {message && <div className="mt-3 text-sm text-red-600">{message}</div>}
      </div>
    </div>
  )
}
