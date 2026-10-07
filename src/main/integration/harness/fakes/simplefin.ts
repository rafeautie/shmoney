import { vi } from 'vitest'
import type { SfinAccountSet } from '../../../simplefin'

// A SimpleFIN bridge behind a stubbed fetch: the claim endpoint hands out an
// access URL, /accounts serves `payload`, and `fault` breaks either one.

type SfinAccount = SfinAccountSet['accounts'][number]
type SfinTransaction = SfinAccount['transactions'][number]
type Fault = number | 'network' | 'junk'

const ORIGIN = 'https://bridge.test'
const ACCESS_URL = `https://user:p%40ss@bridge.test/simplefin`

export interface FakeBridge {
  /** what a user pastes: base64 of the claim URL */
  setupToken: string
  payload: SfinAccountSet
  fault: { claim?: Fault; accounts?: Fault }
  requests: { url: URL; method: string; authorization: string | null }[]
}

export function installBridge(payload: Partial<SfinAccountSet> = {}): FakeBridge {
  const bridge: FakeBridge = {
    setupToken: Buffer.from(`${ORIGIN}/claim/abc123`).toString('base64'),
    payload: { errlist: [], connections: [], accounts: [], ...payload },
    fault: {},
    requests: []
  }

  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    bridge.requests.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization')
    })
    const claim = url.pathname.startsWith('/claim/')
    const fault = claim ? bridge.fault.claim : bridge.fault.accounts
    if (fault === 'network') throw new TypeError('fetch failed')
    if (typeof fault === 'number') return new Response('nope', { status: fault })
    if (claim) return new Response(fault === 'junk' ? 'not a url' : `${ACCESS_URL}\n`)
    if (fault === 'junk') return new Response('{not json', { status: 200 })
    return Response.json(bridge.payload)
  })
  return bridge
}

/** a bridge account; dates are unix seconds */
export function sfinAccount(
  id: string,
  over: Partial<SfinAccount> = {},
  transactions: SfinTransaction[] = []
): SfinAccount {
  return {
    id,
    name: `Account ${id}`,
    currency: 'USD',
    balance: '1000.00',
    'balance-date': 1_727_000_000,
    transactions,
    holdings: [],
    ...over
  }
}

export function sfinTxn(
  id: string,
  amount: string,
  posted: number,
  over: Partial<SfinTransaction> = {}
): SfinTransaction {
  return { id, posted, amount, description: `Txn ${id}`, ...over }
}
