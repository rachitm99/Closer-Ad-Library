import React from 'react'
import './globals.css'
import AuthButton from '../components/AuthButton'
import SideNav from '../components/SideNav'

export const metadata = {
  title: 'Closer Ad Library',
  description: 'Check if an Instagram reel is an ad',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-gradient-to-b from-indigo-50 to-white min-h-screen">
        <header className="bg-white border-b">
          <div className="max-w-full px-4 py-3 flex items-center justify-between">
            <div className="font-semibold">Closer Ad Library</div>
            {/* AuthButton is a client component */}
            <div>
              <AuthButton />
            </div>
          </div>
        </header>
        <div className="flex flex-col md:flex-row">
          <SideNav />
          <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 max-w-full">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
