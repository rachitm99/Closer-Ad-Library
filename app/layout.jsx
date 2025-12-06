import './globals.css'

export const metadata = {
  title: 'Closer Ad Library',
  description: 'Check if an Instagram reel is an ad',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
