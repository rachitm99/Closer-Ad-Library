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
        console.log('[LoginPage] Starting redirect result handling...')
        console.log('[LoginPage] Current URL:', window.location.href)
        
        // Give Firebase a moment to initialize and restore state
        await new Promise(resolve => setTimeout(resolve, 500))
        
        console.log('[LoginPage] LocalStorage keys:', Object.keys(localStorage))
        
        // Check for Firebase auth redirect keys
        const firebaseKeys = Object.keys(localStorage).filter(k => k.includes('firebase'))
        console.log('[LoginPage] Firebase localStorage keys:', firebaseKeys)
        firebaseKeys.forEach(k => console.log(`  ${k}:`, localStorage.getItem(k)?.substring(0, 100)))
        
        const m = await import('../../lib/firebaseClient')
        const { handleRedirectResult } = m
        const res = await handleRedirectResult()
        console.log('[LoginPage] handleRedirectResult ->', res)
        if (res?.token) {
          console.log('[LoginPage] Token received, exchanging for session cookie...')
          // exchange token for session cookie
          const r = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: res.token }) })
          const txt = await r.text()
          console.log('[LoginPage] /api/auth/session response:', r.status, txt)
          if (!r.ok) {
            console.error('[LoginPage] Session creation failed:', r.status, txt)
            if (mounted) setMessage(`Failed to create session: ${txt}`)
          } else {
            console.log('[LoginPage] Session created successfully, redirecting to home...')
            // redirect to home
            window.location.href = '/'
          }
        } else {
          console.log('[LoginPage] No token received from redirect result')
          if (mounted) setProcessing(false)
        }
      } catch (e: any) {
        console.error('[LoginPage] Redirect handling failed:', e)
        if (mounted) setMessage(String(e?.message ?? e))
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
