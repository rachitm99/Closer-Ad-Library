import { NextResponse } from 'next/server'
import { getIdTokenClient } from '../../../../../lib/getIdToken'
import { Firestore } from '@google-cloud/firestore'

// Firestore client with NEXT_SA_KEY fallback
let firestore: Firestore
if (process.env.NEXT_SA_KEY) {
  try {
    const creds = JSON.parse(process.env.NEXT_SA_KEY)
    firestore = new Firestore({ projectId: creds.project_id, credentials: { client_email: creds.client_email, private_key: creds.private_key } })
  } catch (e) {
    console.warn('NEXT_SA_KEY present but failed to parse; falling back to ADC')
    firestore = new Firestore()
  }
} else {
  firestore = new Firestore()
}

export async function POST(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const resolved = await (context.params as any)
    const id = resolved?.id
    if (!id) return NextResponse.json({ message: 'Missing id' }, { status: 400 })

    const body = await request.json()
    // Allow body to provide query_id or default to id
    const query_id = body?.query_id ?? id

    if (!process.env.CLOUD_RUN_URL) return NextResponse.json({ message: 'Server misconfigured: CLOUD_RUN_URL not set' }, { status: 500 })
    const audience = process.env.CLOUD_RUN_URL
    const retryUrl = (process.env.CLOUD_RUN_RETRY_URL || `${audience.replace(/\/$/, '')}/retry`)

    const client = await getIdTokenClient(audience)

    // First attempt: send JSON
    try {
      const res = await client.request({ url: retryUrl, method: 'POST', data: { query_id } } as any)
      if (!res) throw new Error('No response from upstream')
      const statusRaw = res.status as number | string | undefined
      const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
      if (Number.isNaN(status) || status < 200 || status >= 300) {
        // If 404 (route not found), we'll try a form-data variant below
        if (!Number.isNaN(status) && status === 404) {
          throw new Error('Upstream returned 404')
        }
        return NextResponse.json({ message: 'Upstream retry failed', details: res?.data ?? res?.status }, { status: 502 })
      }
      const newResponse = res.data

      // Update Firestore doc with new response and last_queried timestamp
      try {
        const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
        await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
      } catch (e) {
        console.warn('Failed to update Firestore with new response', e)
      }

      return NextResponse.json({ response: newResponse })
    } catch (firstErr: any) {
      // If the first attempt failed and indicated a 404, try a form-data approach (some Cloud Run handlers expect form-encoded data)
      console.warn('Retry: first attempt failed, trying fallback form-data', firstErr?.message || firstErr)
      try {
        const form = new (global as any).FormData()
        form.append('query_id', query_id)
        const res2 = await client.request({ url: retryUrl, method: 'POST', data: form } as any)
        if (!res2) throw new Error('No response from upstream (form-data)')
        const statusRaw2 = res2.status as number | string | undefined
        const status2 = typeof statusRaw2 === 'number' ? statusRaw2 : Number(statusRaw2 ?? NaN)
        if (Number.isNaN(status2) || status2 < 200 || status2 >= 300) {
          return NextResponse.json({ message: 'Upstream retry failed (form-data)', details: res2?.data ?? res2?.status }, { status: 502 })
        }
        const newResponse = res2.data
        try {
          const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
          await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
        } catch (e) {
          console.warn('Failed to update Firestore with new response', e)
        }
        return NextResponse.json({ response: newResponse })
      } catch (secondErr: any) {
        console.error('Retry fallback also failed', secondErr)
        throw secondErr
      }
    }


  } catch (err: any) {
    console.error('Error in /api/queries/[id]/retry', err)
    return NextResponse.json({ message: 'Server error', details: err?.message || String(err) }, { status: 500 })
  }
}
