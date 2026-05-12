import { POST } from '../../app/api/upload-url/route'
import { Storage } from '@google-cloud/storage'

jest.mock('@google-cloud/storage')

describe('upload-url route', () => {
  beforeEach(() => {
    process.env.UPLOAD_BUCKET = 'test-bucket'
    process.env.NEXT_SA_KEY = JSON.stringify({
      client_email: 'test@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n'
    })
  })

  afterEach(() => {
    delete process.env.UPLOAD_BUCKET
    delete process.env.NEXT_SA_KEY
  })

  it('returns signed url and gcsPath', async () => {
    // Mock Storage behavior
    const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://signed.upload/url'])
    const mockFile = { getSignedUrl: mockGetSignedUrl }
    const mockBucket = { file: jest.fn().mockReturnValue(mockFile) }
    ;(Storage as any).mockImplementation(() => ({ bucket: () => mockBucket }))

    const req = new Request('http://localhost/api/upload-url', { method: 'POST', body: JSON.stringify({ filename: 'test.mp4', contentType: 'video/mp4' }) })
    const res = await POST(req as any)
    const json = await (res as any).json()
    expect(json.uploadUrl).toBe('https://signed.upload/url')
    expect(json.gcsPath).toBe('gs://test-bucket/test.mp4')
  })
})
