"use client"
import React from 'react'
import GcsUploader from '../../components/GcsUploader'
import VideoQuery from '../../components/VideoQuery'

export default function VideoQueryPage(): React.ReactElement {
  return (
    <main className="p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold mb-4">Video Query</h1>
        <p className="text-sm text-gray-600 mb-4">Choose the small-file uploader to post directly to the server, or use the GCS uploader for larger files.</p>

        <section>
          <h2 className="text-lg font-medium mb-2">Small-file uploader</h2>
          <p className="text-sm text-gray-500 mb-3">Use the small-file uploader for quick tests (includes brand search).</p>
          <VideoQuery />
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-medium mb-2">Upload & Query (recommended)</h2>
          <GcsUploader />
        </section>
      </div>
    </main>
  )
}

