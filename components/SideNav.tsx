"use client"
import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function SideNav(): React.ReactElement {
  const pathname = usePathname()

  const navItems = [
    { href: '/', label: 'Track New Video', icon: '🎥' },
    { href: '/tracker', label: 'All Videos', icon: '📌' },
  ]

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r min-h-screen flex-col">
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-800">Menu</h2>
        </div>
        <nav className="flex-1 px-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Mobile top nav */}
      <div className="md:hidden bg-white border-b">
        <nav className="flex px-2 sm:px-4 py-2 overflow-x-auto">
          {navItems.map(item => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-md mr-2 whitespace-nowrap ${
                  isActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}
