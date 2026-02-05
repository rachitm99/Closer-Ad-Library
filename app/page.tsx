import React from 'react'
import VideoQuery from '../components/VideoQuery'

export default function Page(): React.ReactElement {
  return (
    <main className="p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-4">Track New Video</h1>
        <VideoQuery />
      
      </div>
    </main>
  )
}
