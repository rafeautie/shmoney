import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchAccounts, parseAmount, SfinErrlistError } from './simplefin'

// The bridge is the one input this app doesn't control, so the parse has to be
// specific about what it tolerates. Nothing here touches the network: fetch is
// stubbed, which also lets the request itself be asserted.

const ACCESS_URL = 'https://user:pa%3Ass@bridge.example/simplefin'

function stubFetch(payload: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok, status: ok ? 200 : 403, json: async () => payload })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acct-1',
    name: 'Checking',
    currency: 'USD',
    balance: '100.25',
    'balance-date': 1781179200,
    ...overrides
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('parseAmount', () => {
  it('converts decimal strings to integer milliunits', () => {
    expect(parseAmount('100.25')).toBe(100250)
    expect(parseAmount('-0.01')).toBe(-10)
  })

  it('rejects an unparseable amount rather than storing NaN', () => {
    expect(() => parseAmount('n/a')).toThrow(/unparseable/)
  })
})

describe('fetchAccounts', () => {
  it('moves credentials to a header and asks for pending rows from the start date', async () => {
    const fetchMock = stubFetch({ accounts: [account()] })
    await fetchAccounts(ACCESS_URL, 1781179200)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://bridge.example/simplefin/accounts?version=2&start-date=1781179200&pending=1'
    )
    // fetch() rejects URLs with embedded credentials, and the password is
    // percent-decoded before being re-encoded into the header
    expect(String(url)).not.toContain('user')
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('user:pa:ss').toString('base64')}`)
  })

  it('accepts an account with no balance instead of failing the whole sync', async () => {
    // one balance-less account used to throw at the parse, taking every other
    // account on the bridge down with it
    stubFetch({ accounts: [account({ balance: undefined }), account({ id: 'acct-2' })] })
    const payload = await fetchAccounts(ACCESS_URL, 0)
    expect(payload.accounts[0].balance).toBeUndefined()
    expect(payload.accounts[1].balance).toBe('100.25')
  })

  it('treats errlist as fatal only when no account data came back', async () => {
    const errlist = [{ code: 'transient', msg: 'date range capped' }]
    stubFetch({ errlist, accounts: [account()] })
    await expect(fetchAccounts(ACCESS_URL, 0)).resolves.toMatchObject({ errlist })

    stubFetch({ errlist, accounts: [] })
    await expect(fetchAccounts(ACCESS_URL, 0)).rejects.toBeInstanceOf(SfinErrlistError)
  })

  it('throws on a non-ok response', async () => {
    stubFetch({}, false)
    await expect(fetchAccounts(ACCESS_URL, 0)).rejects.toThrow(/HTTP 403/)
  })
})
