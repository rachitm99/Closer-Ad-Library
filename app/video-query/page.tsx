import React from 'react'
import VideoQuery from '../../components/VideoQuery'

export default function Page(): React.ReactElement {
  return (
    <main className="p-4">
      <div className="max-w-3xl mx-auto">
        <VideoQuery />
      </div>
    </main>
  )
}
