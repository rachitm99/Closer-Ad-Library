import Link from 'next/link'
import TrackerAds from '../../components/TrackerAds'

export const metadata = {
  title: 'Tracker Ads'
}

export default function Page() {
  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Tracker Ads</h1>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-indigo-600 hover:underline">Video Query (Home)</Link>
        </div>
      </div>
      <TrackerAds />
    </div>
  )
}