import TrackedAds from '../../components/TrackedAds'

export const metadata = {
  title: 'Tracked Ads'
}

export default function Page() {
  return (
    <div className="max-w-5xl mx-auto p-4">
      <TrackedAds />
    </div>
  )
}