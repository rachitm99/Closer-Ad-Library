import React from 'react'
import VideoQuery from '../components/VideoQuery'
import Link from 'next/link'

export default function Page(): React.ReactElement {
  return (
    <main className="p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Closer Ad Library</h1>
          <div className="flex items-center gap-4">
            <Link href="/link-query" className="text-sm text-indigo-600 hover:underline">Link Query</Link>
            <Link href="/tracked" className="text-sm text-indigo-600 hover:underline">Tracked</Link>
          </div>
        </div>
        <VideoQuery />
      
      </div>
    </main>
  )
}
