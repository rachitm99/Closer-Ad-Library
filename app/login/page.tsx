"use client"
import React from 'react'
import AuthButton from '../../components/AuthButton'

export default function LoginPage(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center bg-indigo-50">
      <div className="bg-white p-8 rounded shadow text-center">
        <h1 className="text-xl font-semibold mb-4">Sign in</h1>
        <p className="text-sm text-gray-600 mb-4">You must sign in to access this site.</p>
        <AuthButton />
      </div>
    </div>
  )
}
