/**
 * Dry-run test example for `app/api/query/route.ts`.
 *
 * This test demonstrates mocking the ID token client and the upstream Cloud Run
 * POST request and asserting that the route returns a top-10 truncated result.
 * It's a template — adjust to your test runner (Jest/Vitest) and environment.
 */

import { POST } from '../app/api/query/route'

// Mock getIdTokenClient to return a client with getRequestHeaders
jest.mock('../lib/getIdToken', () => ({
  getIdTokenClient: async (aud: string) => ({
    getRequestHeaders: async () => ({ authorization: 'Bearer TEST_TOKEN' }),
  }),
}))

describe('POST /api/query', () => {
  it('forwards multipart to cloud run and returns top 10', async () => {
    // mock fetch for upstream Cloud Run
    const fakeResults = { results: Array.from({ length: 20 }, (_, i) => ({ video_id: String(i), avg_similarity: Math.random(), max_similarity: 1, matches_count: Math.floor(Math.random() * 100) })) }

    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fakeResults }) as any

    // Build a simple multipart request using FormData (Node 18+ or test polyfills)
    const form = new FormData()
    form.append('page_id', '123')
    form.append('file', new Blob(['hello'], { type: 'video/mp4' }), 'test.mp4')

    const req = new Request('http://localhost/api/query', { method: 'POST', body: form })
    const res = await POST(req as any)

    expect((res as any).status).toBeUndefined() // NextResponse.json returns NextResponse-like; check payload
    const json = await (res as any).json()
    expect(json.results.length).toBeLessThanOrEqual(10)
  })
})
