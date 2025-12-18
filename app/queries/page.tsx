"use client"
import React from 'react'
import QueriesDashboard from '../../components/QueriesDashboard'

export default function QueriesPage(): React.ReactElement {
  return (
    <main className="p-4">
      <div className="max-w-6xl mx-auto">
        <QueriesDashboard />
      </div>
    </main>
  )
}
