import React from 'react'
import VideoQuery from '../components/VideoQuery'

export default function Page(): React.ReactElement {
  return (
    <main className="p-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold mb-4">Video Query</h1>
        <VideoQuery />
      
      </div>
    </main>
  )
}
