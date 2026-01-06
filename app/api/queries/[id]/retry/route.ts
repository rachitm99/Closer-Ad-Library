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
    let uid: string
    try {
      uid = await (await import('../../../../../lib/firebaseAdmin')).getUidFromAuthHeader(request.headers)
    } catch (e: any) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const resolved = await (context.params as any)
    const id = resolved?.id
    if (!id) return NextResponse.json({ message: 'Missing id' }, { status: 400 })

    // ensure the query belongs to this user
    const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
    const doc = await docRef.get()
    if (!doc.exists) return NextResponse.json({ message: 'Not found' }, { status: 404 })
    const data = doc.data() as any
    if (data?.uid !== uid) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    // Allow body to provide query_id or default to id
    const query_id = body?.query_id ?? id

    if (!process.env.CLOUD_RUN_URL) return NextResponse.json({ message: 'Server misconfigured: CLOUD_RUN_URL not set' }, { status: 500 })
    const audience = process.env.CLOUD_RUN_URL
    const retryUrl = (process.env.CLOUD_RUN_RETRY_URL || `${audience.replace(/\/$/, '')}/retry`)

    const client = await getIdTokenClient(audience)

    // keep track of each attempt for debugging
    const attempts: Array<{ type: string, status?: number, body?: any, error?: string }> = []

    // Attempt 1: JSON POST
    try {
      const res = await client.request({ url: retryUrl, method: 'POST', data: { query_id } } as any)
      attempts.push({ type: 'POST json', status: res?.status, body: res?.data })
      if (res && typeof res.status !== 'undefined') {
        const statusRaw = res.status as number | string | undefined
        const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw ?? NaN)
        if (!Number.isNaN(status) && status >= 200 && status < 300) {
          const newResponse = res.data
          try {
            const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
            await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
          } catch (e) {
            console.warn('Failed to update Firestore with new response', e)
          }
          return NextResponse.json({ response: newResponse })
        }
      }
    } catch (firstErr: any) {
      const detail = firstErr?.response ? { status: firstErr.response.status, body: firstErr.response.data } : { message: String(firstErr?.message ?? firstErr) }
      attempts.push({ type: 'POST json failed', ...detail })
      console.warn('Retry: first attempt (json) failed', firstErr?.message || firstErr)
    }

    // Attempt 2: multipart/form-data (closest to curl -F)
    try {
      const form = new (global as any).FormData()
      form.append('query_id', query_id)
      const res2 = await client.request({ url: retryUrl, method: 'POST', data: form } as any)
      attempts.push({ type: 'POST form-data', status: res2?.status, body: res2?.data })
      if (res2 && typeof res2.status !== 'undefined') {
        const statusRaw2 = res2.status as number | string | undefined
        const status2 = typeof statusRaw2 === 'number' ? statusRaw2 : Number(statusRaw2 ?? NaN)
        if (!Number.isNaN(status2) && status2 >= 200 && status2 < 300) {
          const newResponse = res2.data
          try {
            const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
            await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
          } catch (e) {
            console.warn('Failed to update Firestore with new response', e)
          }
          return NextResponse.json({ response: newResponse })
        }
      }
    } catch (secondErr: any) {
      const detail = secondErr?.response ? { status: secondErr.response.status, body: secondErr.response.data } : { message: String(secondErr?.message ?? secondErr) }
      attempts.push({ type: 'POST form-data failed', ...detail })
      console.error('Retry: form-data attempt failed', secondErr)
    }

    // Attempt 3: application/x-www-form-urlencoded
    try {
      const params = new URLSearchParams()
      params.append('query_id', query_id)
      const res3 = await client.request({ url: retryUrl, method: 'POST', data: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } } as any)
      attempts.push({ type: 'POST urlencoded', status: res3?.status, body: res3?.data })
      if (res3 && typeof res3.status !== 'undefined') {
        const statusRaw3 = res3.status as number | string | undefined
        const status3 = typeof statusRaw3 === 'number' ? statusRaw3 : Number(statusRaw3 ?? NaN)
        if (!Number.isNaN(status3) && status3 >= 200 && status3 < 300) {
          const newResponse = res3.data
          try {
            const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
            await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
          } catch (e) {
            console.warn('Failed to update Firestore with new response', e)
          }
          return NextResponse.json({ response: newResponse })
        }
      }
    } catch (thirdErr: any) {
      const detail = thirdErr?.response ? { status: thirdErr.response.status, body: thirdErr.response.data } : { message: String(thirdErr?.message ?? thirdErr) }
      attempts.push({ type: 'POST urlencoded failed', ...detail })
      console.error('Retry: urlencoded attempt failed', thirdErr)
    }

    // GET fallbacks
    try {
      const url1 = `${retryUrl}${retryUrl.includes('?') ? '&' : '?'}query_id=${encodeURIComponent(query_id)}`
      const res4 = await client.request({ url: url1, method: 'GET' } as any)
      attempts.push({ type: 'GET query_id', status: res4?.status, body: res4?.data })
      const statusRaw4 = res4.status as number | string | undefined
      const status4 = typeof statusRaw4 === 'number' ? statusRaw4 : Number(statusRaw4 ?? NaN)
      if (!Number.isNaN(status4) && status4 >= 200 && status4 < 300) {
        const newResponse = res4.data
        try {
          const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
          await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
        } catch (e) {
          console.warn('Failed to update Firestore with new response', e)
        }
        return NextResponse.json({ response: newResponse })
      }
    } catch (gErr) {
      const detail = gErr?.response ? { status: gErr.response.status, body: gErr.response.data } : { message: String(gErr?.message ?? gErr) }
      attempts.push({ type: 'GET query_id failed', ...detail })
    }

    try {
      const url2 = `${retryUrl}${retryUrl.includes('?') ? '&' : '?'}id=${encodeURIComponent(query_id)}`
      const res5 = await client.request({ url: url2, method: 'GET' } as any)
      attempts.push({ type: 'GET id', status: res5?.status, body: res5?.data })
      const statusRaw5 = res5.status as number | string | undefined
      const status5 = typeof statusRaw5 === 'number' ? statusRaw5 : Number(statusRaw5 ?? NaN)
      if (!Number.isNaN(status5) && status5 >= 200 && status5 < 300) {
        const newResponse = res5.data
        try {
          const docRef = firestore.collection(process.env.FIRESTORE_COLLECTION || 'queries').doc(id)
          await docRef.update({ response: newResponse, last_queried: new Date().toISOString() })
        } catch (e) {
          console.warn('Failed to update Firestore with new response', e)
        }
        return NextResponse.json({ response: newResponse })
      }
    } catch (gErr2) {
      const detail = gErr2?.response ? { status: gErr2.response.status, body: gErr2.response.data } : { message: String(gErr2?.message ?? gErr2) }
      attempts.push({ type: 'GET id failed', ...detail })
    }

    return NextResponse.json({ message: 'Upstream retry failed (all attempts)', attempts, retryUrl }, { status: 502 })


  } catch (err: any) {
    console.error('Error in /api/queries/[id]/retry', err)
    return NextResponse.json({ message: 'Server error', details: err?.message || String(err) }, { status: 500 })
  }
}
