import { describe, it, expect, vi, afterEach } from 'vitest'
import { findNewerMacRelease, isNewerVersion } from './release-check'

// fetch is stubbed; nothing here touches GitHub

function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: status < 400, status, json: async () => payload })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.4.0',
    html_url: 'https://github.com/rafeautie/shmoney/releases/tag/v0.4.0',
    assets: [{ name: 'shmoney-0.4.0-setup.exe' }, { name: 'shmoney-0.4.0.dmg' }],
    ...overrides
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('isNewerVersion', () => {
  it('compares each part numerically, not as text', () => {
    expect(isNewerVersion('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true)
    expect(isNewerVersion('0.3.3', '0.3.3')).toBe(false)
    expect(isNewerVersion('0.3.2', '0.3.3')).toBe(false)
  })

  it('ignores versions it cannot read', () => {
    expect(isNewerVersion('v1.0.0-beta.1', '0.3.3')).toBe(false)
    expect(isNewerVersion('latest', '0.3.3')).toBe(false)
  })
})

describe('findNewerMacRelease', () => {
  it('returns the version and page of a newer release with a mac build', async () => {
    stubFetch(release())
    await expect(findNewerMacRelease('0.3.3')).resolves.toEqual({
      version: '0.4.0',
      url: 'https://github.com/rafeautie/shmoney/releases/tag/v0.4.0'
    })
  })

  it('returns null when already on the latest version', async () => {
    stubFetch(release({ tag_name: 'v0.3.3' }))
    await expect(findNewerMacRelease('0.3.3')).resolves.toBeNull()
  })

  it('skips a release that has no mac build attached', async () => {
    stubFetch(release({ assets: [{ name: 'shmoney-0.4.0-setup.exe' }] }))
    await expect(findNewerMacRelease('0.3.3')).resolves.toBeNull()
  })

  it('returns null when nothing has been published yet', async () => {
    stubFetch({ message: 'Not Found' }, 404)
    await expect(findNewerMacRelease('0.3.3')).resolves.toBeNull()
  })

  it('throws on other GitHub errors so they reach the About card', async () => {
    stubFetch({ message: 'rate limited' }, 403)
    await expect(findNewerMacRelease('0.3.3')).rejects.toThrow(/403/)
  })
})
