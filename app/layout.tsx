import React from 'react'
import './globals.css'
import AuthButton from '../components/AuthButton'

export const metadata = {
  title: 'Closer Ad Library',
  description: 'Check if an Instagram reel is an ad',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-gradient-to-b from-indigo-50 to-white min-h-screen">
        <header className="bg-white border-b">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="font-semibold">Closer Ad Library</div>
            {/* AuthButton is a client component */}
            <div>
              <AuthButton />
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}
