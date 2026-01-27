"use client"
import React from 'react'

type Props = {
  adInfo: any
  onClose: () => void
  adId?: string | null
}

export default function AdModal({ adInfo, onClose, adId }: Props): React.ReactElement {
  const snapshot = adInfo?.snapshot ?? {}
  const title = snapshot.title ?? adInfo?.title ?? ''
  const body = snapshot.body ?? ''
  const pageName = snapshot.page_name ?? snapshot.pageName ?? adInfo?.pageName ?? ''
  const pagePic = snapshot.page_profile_picture_url ?? ''
  const link = snapshot.link_url ?? adInfo?.url ?? ''
  const videos = Array.isArray(snapshot.videos) ? snapshot.videos : []
  const images = Array.isArray(snapshot.images) ? snapshot.images : []
  const start = adInfo?.startDate ? new Date(adInfo.startDate * 1000) : (adInfo?.startDateString ? new Date(adInfo.startDateString) : null)
  const end = adInfo?.endDate ? new Date(adInfo.endDate * 1000) : (adInfo?.endDateString ? new Date(adInfo.endDateString) : null)

  const fmtIST = (d: Date | null) => d ? d.toLocaleString(undefined, { timeZone: 'Asia/Kolkata', timeZoneName: 'short' }) : '—' 

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 overflow-auto max-h-[90vh]">
        <div className="flex items-center gap-3 p-4 border-b">
          {pagePic ? <img src={pagePic} alt={pageName} className="w-12 h-12 rounded-full object-cover" /> : null}
          <div className="flex-1">
            <div className="text-sm text-gray-500">Ad ID: <span className="font-mono text-xs">{adId}</span></div>
            <div className="text-lg font-semibold">{title || pageName}</div>
            {pageName ? <div className="text-sm text-gray-500">{pageName}</div> : null}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 ml-auto px-3 py-1">Close</button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            {videos && videos.length > 0 ? (
              <img src={videos[0].video_preview_image_url ?? videos[0].image ?? ''} alt="Preview" className="w-full h-64 object-cover rounded" />
            ) : images && images.length > 0 ? (
              <img src={images[0]} alt="Image" className="w-full h-64 object-cover rounded" />
            ) : null}

            {link ? (
              <div className="mt-3"><a href={link} target="_blank" rel="noreferrer" className="text-indigo-600 break-all">{link}</a></div>
            ) : null}

            {body ? (
              <div className="mt-3 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: body }} />
            ) : null}
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">Snapshot Details</h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li><strong>Page ID:</strong> {snapshot.page_id ?? adInfo?.pageID ?? '—'}</li>

              <li>
                <strong>Start (IST):</strong>
                <div className="text-sm text-gray-700">{fmtIST(start)}</div>
              </li>

              <li>
                <strong>End (IST):</strong>
                <div className="text-sm text-gray-700">{fmtIST(end)}</div>
              </li>
            </ul>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-700">View raw ad JSON</summary>
              <pre className="whitespace-pre-wrap max-h-64 overflow-auto mt-2 text-xs bg-gray-50 p-2 rounded">{JSON.stringify(adInfo, null, 2)}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}
