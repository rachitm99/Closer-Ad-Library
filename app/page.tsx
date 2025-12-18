import React from 'react'
import ReelChecker from '../components/ReelChecker'
import Link from 'next/link'

export default function Page(): React.ReactElement {
  return (
    <main className="p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Closer Ad Library</h1>
          <div className="flex items-center gap-4">
            <Link href="/video-query" className="text-sm text-indigo-600 hover:underline">Video Query</Link>
            <Link href="/queries" className="text-sm text-indigo-600 hover:underline">Queries</Link>
          </div>
        </div>
        <ReelChecker />
      </div>
    </main>
  )
}
