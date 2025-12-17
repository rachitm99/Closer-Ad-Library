import React from 'react'
import './globals.css'

export const metadata = {
  title: 'Closer Ad Library',
  description: 'Check if an Instagram reel is an ad',
}

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-gradient-to-b from-indigo-50 to-white min-h-screen">{children}</body>
    </html>
  )
}
