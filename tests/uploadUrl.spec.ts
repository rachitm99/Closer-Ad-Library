import { POST } from '../../app/api/upload-url/route'
import { Storage } from '@google-cloud/storage'

jest.mock('@google-cloud/storage')

describe('upload-url route', () => {
  it('returns signed url and gcsPath', async () => {
    // Mock Storage behavior
    const mockGetSignedUrl = jest.fn().mockResolvedValue(['https://signed.upload/url'])
    const mockFile = { getSignedUrl: mockGetSignedUrl }
    const mockBucket = { file: jest.fn().mockReturnValue(mockFile) }
    ;(Storage as any).mockImplementation(() => ({ bucket: () => mockBucket }))

    const req = new Request('http://localhost/api/upload-url', { method: 'POST', body: JSON.stringify({ filename: 'test.mp4', contentType: 'video/mp4' }) })
    const res = await POST(req as any)
    const json = await (res as any).json()
    expect(json.uploadUrl).toBeDefined()
    expect(json.gcsPath).toBe('gs://undefined/test.mp4') // bucketName undefined in test env; adjust when adding env
  })
})
