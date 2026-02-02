import TrackerAds from '../../components/TrackerAds'

export const metadata = {
  title: 'Tracker Ads'
}

export default function Page() {
  return (
    <div className="max-w-5xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Tracker</h1>
      <TrackerAds />
    </div>
  )
}