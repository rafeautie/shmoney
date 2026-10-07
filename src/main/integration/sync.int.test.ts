import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './harness/api'
import { account, category, noon, rule, systemCategory, txn } from './harness/builders'
import { count, query } from './harness/db'
import { accessUrlKeychain } from './harness/fakes/access-url'
import { installBridge, sfinAccount, sfinTxn, type FakeBridge } from './harness/fakes/simplefin'
import { allowDemoTokens, type SfinAccountSet } from '../simplefin'
import { actionNeededErrors } from '@shared/ipc'
import { beginSyncGuard, guardedSync, resetSyncState } from './harness/sync'

const NOW = new Date(2026, 9, 5, 12)
const nowSeconds = NOW.getTime() / 1000
const DAY = 24 * 60 * 60

beforeEach(async () => {
  await resetSyncState()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

async function connect(payload: Partial<SfinAccountSet> = {}): Promise<FakeBridge> {
  const bridge = installBridge(payload)
  await api.connection.connect({ setupToken: bridge.setupToken })
  return bridge
}

const accountRequests = (bridge: FakeBridge): FakeBridge['requests'] =>
  bridge.requests.filter((r) => r.url.pathname.endsWith('/accounts'))

type AccountRow = {
  id: number
  name: string
  institution_name: string | null
  currency: string
  balance: number
  available_balance: number | null
  balance_date: number
}

const accountBySfid = (simplefinId: string): AccountRow =>
  query<AccountRow>(`SELECT * FROM accounts WHERE simplefin_id = '${simplefinId}'`)[0]

const txnsOf = (simplefinAccountId: string): Record<string, unknown>[] =>
  query(
    `SELECT t.simplefin_id AS id, t.amount, t.pending, t.category_id, t.deleted_at
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.simplefin_id = '${simplefinAccountId}' ORDER BY t.simplefin_id`
  )

const categoryOf = (id: number): number | null =>
  query<{ c: number | null }>(`SELECT category_id AS c FROM transactions WHERE id = ${id}`)[0].c

const connectionRow = (): Record<string, unknown> => query('SELECT * FROM connections')[0]

describe('connect', () => {
  it('stores the access URL sealed, returns none of it, and does not sync', async () => {
    const bridge = installBridge()
    const result = await api.connection.connect({ setupToken: bridge.setupToken })

    expect(result.bridgeUrl).toBe('https://bridge.test')
    expect(result.lastSyncedAt).toBeNull()
    expect(JSON.stringify(result)).not.toMatch(/p%40ss|sealed|accessUrl/i)

    const stored = connectionRow().access_url_encrypted as string
    expect(stored.startsWith('sealed:')).toBe(true)
    expect(stored).not.toContain('bridge.test')
    expect(stored).not.toContain('p%40ss')

    // only the claim went out; no /accounts call and no data
    expect(bridge.requests).toHaveLength(1)
    expect(bridge.requests[0]).toMatchObject({ method: 'POST' })
    expect(bridge.requests[0].url.pathname).toBe('/claim/abc123')
    expect(count('accounts')).toBe(0)
    expect(await api.connection.get()).toMatchObject({
      lastSyncedAt: null,
      bridgeUrl: 'https://bridge.test'
    })
  })

  it('get is null before anything is connected', async () => {
    expect(await api.connection.get()).toBeNull()
  })

  it('rejects a blank token before touching the network', async () => {
    const bridge = installBridge()
    await expect(api.connection.connect({ setupToken: '   ' })).rejects.toThrow()
    expect(bridge.requests).toEqual([])
    expect(count('connections')).toBe(0)
  })

  it('refuses when credentials cannot be encrypted, without claiming the token', async () => {
    const bridge = installBridge()
    accessUrlKeychain.available = false
    await expect(api.connection.connect({ setupToken: bridge.setupToken })).rejects.toThrow(
      /encryption is not available/
    )
    expect(bridge.requests).toEqual([])
    expect(count('connections')).toBe(0)
  })

  it('refuses a second connection before claiming another token', async () => {
    const bridge = await connect()
    await expect(api.connection.connect({ setupToken: bridge.setupToken })).rejects.toThrow(
      /Already connected/
    )
    expect(bridge.requests).toHaveLength(1)
    expect(count('connections')).toBe(1)
  })

  it.each([
    ['is not base64 of a URL', 'not a url at all', /not valid/],
    [
      'decodes to an http URL',
      Buffer.from('http://bridge.test/claim/abc').toString('base64'),
      /https URL/
    ]
  ])('rejects a token that %s without a request', async (_name, token, message) => {
    const bridge = installBridge()
    await expect(api.connection.connect({ setupToken: token })).rejects.toThrow(message)
    expect(bridge.requests).toEqual([])
    expect(count('connections')).toBe(0)
  })

  it.each([
    ['a 403', 403, /claim failed \(HTTP 403\)/],
    ['a 500', 500, /claim failed \(HTTP 500\)/],
    ['a network failure', 'network' as const, /fetch failed/]
  ])('stores nothing when the claim gets %s', async (_name, fault, message) => {
    const bridge = installBridge()
    bridge.fault.claim = fault
    await expect(api.connection.connect({ setupToken: bridge.setupToken })).rejects.toThrow(message)
    expect(count('connections')).toBe(0)
  })

  it.each([
    ['without credentials', 'https://bridge.test/simplefin'],
    ['that is not a URL', 'welcome!']
  ])('rejects a claim body %s', async (_name, body) => {
    const bridge = installBridge()
    vi.stubGlobal('fetch', async () => new Response(body))
    await expect(api.connection.connect({ setupToken: bridge.setupToken })).rejects.toThrow(
      /did not return a valid access URL/
    )
    expect(count('connections')).toBe(0)
  })

  it('connects a demo dataset token and rejects an unknown one', async () => {
    const result = await api.connection.connect({ setupToken: 'demo:household' })
    // a demo URL has no origin to link to
    expect(result.bridgeUrl).toBeNull()
    expect(count('connections')).toBe(1)
    await api.connection.disconnect()

    await expect(api.connection.connect({ setupToken: 'demo:nope' })).rejects.toThrow(
      /Unknown demo dataset/
    )
    expect(count('connections')).toBe(0)
  })

  it('reads a demo token as an invalid one where sample data is off (packaged builds)', async () => {
    allowDemoTokens(false)
    try {
      await expect(api.connection.connect({ setupToken: 'demo:household' })).rejects.toThrow(
        /Setup token is not valid/
      )
      expect(count('connections')).toBe(0)
    } finally {
      allowDemoTokens()
    }
  })
})

describe('sync', () => {
  it('fails cleanly when not connected', async () => {
    installBridge()
    await expect(api.connection.sync()).rejects.toThrow('Not connected to SimpleFIN')
  })

  it('asks for 90 days on the first sync and lastSyncedAt minus 7 days after', async () => {
    const bridge = await connect({ accounts: [sfinAccount('a1')] })

    const first = await api.connection.sync()
    expect(first.lastSyncedAt).toBe(nowSeconds)
    const [firstReq] = accountRequests(bridge)
    expect(firstReq.url.searchParams.get('start-date')).toBe(String(nowSeconds - 90 * DAY))
    expect(firstReq.url.searchParams.get('pending')).toBe('1')
    expect(firstReq.url.searchParams.get('version')).toBe('2')
    // credentials move to a header; the URL itself carries none
    expect(firstReq.url.username).toBe('')
    expect(Buffer.from(firstReq.authorization!.replace('Basic ', ''), 'base64').toString()).toBe(
      'user:p@ss'
    )

    vi.setSystemTime(new Date(NOW.getTime() + 3 * DAY * 1000))
    await api.connection.sync()
    const second = accountRequests(bridge)[1]
    expect(second.url.searchParams.get('start-date')).toBe(String(nowSeconds - 7 * DAY))
  })

  it('inserts accounts with the bridge name and institution, and updates currency and institution later', async () => {
    const bridge = await connect({
      connections: [{ conn_id: 'c1', name: 'First Bank' }],
      accounts: [sfinAccount('a1', { name: 'Everyday', conn_id: 'c1', currency: 'USD' })]
    })
    await api.connection.sync()
    expect(accountBySfid('a1')).toMatchObject({
      name: 'Everyday',
      institution_name: 'First Bank',
      currency: 'USD'
    })

    bridge.payload.connections = [{ conn_id: 'c1', name: 'First Bank & Trust' }]
    bridge.payload.accounts = [
      sfinAccount('a1', { name: 'Renamed upstream', conn_id: 'c1', currency: 'EUR' })
    ]
    await api.connection.sync()
    // the user's name wins, the bank-owned columns follow the bridge
    expect(accountBySfid('a1')).toMatchObject({
      name: 'Everyday',
      institution_name: 'First Bank & Trust',
      currency: 'EUR'
    })
    expect(count('accounts')).toBe(1)
  })

  it('anchors the balance, with available "0.00" kept as 0 and absent as null', async () => {
    const bridge = await connect({
      accounts: [
        sfinAccount('a1', {
          balance: '1234.56',
          'available-balance': '0.00',
          'balance-date': 1_727_000_000
        }),
        sfinAccount('a2', { balance: '10.00' })
      ]
    })
    await api.connection.sync()
    expect(accountBySfid('a1')).toMatchObject({
      balance: 1_234_560,
      available_balance: 0,
      balance_date: 1_727_000_000
    })
    expect(accountBySfid('a2').available_balance).toBeNull()

    // a later sync with no available figure clears it
    bridge.payload.accounts = [sfinAccount('a1', { balance: '1300.00' })]
    await api.connection.sync()
    expect(accountBySfid('a1')).toMatchObject({ balance: 1_300_000, available_balance: null })
  })

  it('tolerates a missing balance: new accounts start at 0, existing ones keep their anchor', async () => {
    const bridge = await connect({
      accounts: [
        sfinAccount('a1', { balance: '500.00', 'available-balance': '480.00' }),
        sfinAccount('a2', { balance: undefined })
      ]
    })
    await api.connection.sync()
    expect(accountBySfid('a2')).toMatchObject({ balance: 0, balance_date: 0 })

    bridge.payload.accounts = [
      sfinAccount('a1', { balance: undefined, 'balance-date': 1_728_000_000 })
    ]
    await api.connection.sync()
    expect(accountBySfid('a1')).toMatchObject({
      balance: 500_000,
      available_balance: 480_000,
      balance_date: 1_727_000_000
    })
  })

  it('parses amounts to exact milliunits', async () => {
    await connect({
      accounts: [
        sfinAccount('a1', {}, [
          sfinTxn('t1', '-12.34', noon(2026, 9, 1)),
          sfinTxn('t2', '0.1', noon(2026, 9, 2)),
          sfinTxn('t3', '1500', noon(2026, 9, 3))
        ])
      ]
    })
    await api.connection.sync()
    expect(txnsOf('a1').map((t) => t.amount)).toEqual([-12_340, 100, 1_500_000])
  })

  describe('pending rows', () => {
    it('are swept when the charge posts under the same id', async () => {
      const bridge = await connect({
        accounts: [sfinAccount('a1', {}, [sfinTxn('p1', '-20.00', 0, { pending: true })])]
      })
      await api.connection.sync()
      expect(txnsOf('a1')).toMatchObject([{ id: 'p1', pending: 1 }])

      bridge.payload.accounts = [
        sfinAccount('a1', {}, [sfinTxn('p1', '-20.00', noon(2026, 10, 4))])
      ]
      await guardedSync()
      expect(txnsOf('a1')).toMatchObject([{ id: 'p1', pending: 0 }])
    })

    it('are swept when the charge posts under a different id, and settled rows are left alone', async () => {
      const bridge = await connect({
        accounts: [
          sfinAccount('a1', {}, [
            sfinTxn('old', '-5.00', noon(2026, 9, 20)),
            sfinTxn('p1', '-20.00', 0, { pending: true })
          ])
        ]
      })
      await api.connection.sync()

      bridge.payload.accounts = [
        sfinAccount('a1', {}, [
          sfinTxn('old', '-5.00', noon(2026, 9, 20)),
          sfinTxn('posted-1', '-20.00', noon(2026, 10, 4))
        ])
      ]
      await guardedSync()
      expect(txnsOf('a1').map((t) => t.id)).toEqual(['old', 'posted-1'])
    })
  })

  it('replaces holdings per account and drops positions no longer reported', async () => {
    const holding = (
      id: string,
      value: string
    ): SfinAccountSet['accounts'][number]['holdings'][number] => ({
      id,
      symbol: id.toUpperCase(),
      description: `Position ${id}`,
      currency: 'USD',
      shares: '2.5',
      market_value: value,
      cost_basis: '100.00',
      purchase_price: '40.00',
      created: 1_700_000_000
    })
    const bridge = await connect({
      accounts: [sfinAccount('a1', { holdings: [holding('h1', '300.00'), holding('h2', '50.00')] })]
    })
    await api.connection.sync()
    const id = accountBySfid('a1').id
    expect((await api.accounts.holdings(id)).map((h) => h.simplefinId)).toEqual(['h1', 'h2'])

    bridge.payload.accounts = [
      sfinAccount('a1', { holdings: [holding('h1', '350.00'), holding('h3', '10.00')] })
    ]
    await api.connection.sync()
    const held = await api.accounts.holdings(id)
    expect(held.map((h) => [h.simplefinId, h.marketValue])).toEqual([
      ['h1', 350_000],
      ['h3', 10_000]
    ])
    expect(held[0]).toMatchObject({ shares: '2.5', costBasis: 100_000, purchasePrice: 40_000 })
  })

  it('rolls the whole sync back when an amount is unparseable', async () => {
    const bridge = await connect({
      accounts: [
        sfinAccount('a1', { balance: '100.00' }, [sfinTxn('t1', '-1.00', noon(2026, 9, 1))])
      ]
    })
    await api.connection.sync()
    const lastSyncedAt = connectionRow().last_synced_at

    vi.setSystemTime(new Date(NOW.getTime() + DAY * 1000))
    bridge.payload.accounts = [
      sfinAccount('a1', { balance: '999.00' }, [sfinTxn('t2', '-2.00', noon(2026, 9, 2))]),
      sfinAccount('a2', {}, [sfinTxn('bad', 'twelve', noon(2026, 9, 3))])
    ]
    await expect(guardedSync()).rejects.toThrow(/unparseable amount: "twelve"/)

    expect(accountBySfid('a2')).toBeUndefined()
    expect(accountBySfid('a1').balance).toBe(100_000)
    expect(txnsOf('a1').map((t) => t.id)).toEqual(['t1'])
    expect(connectionRow()).toMatchObject({ last_synced_at: lastSyncedAt })
    expect(connectionRow().last_sync_failure).toMatch(/unparseable amount/)
  })

  describe('errlist', () => {
    it('keeps warnings alongside accounts as a successful sync, and a clean sync clears them', async () => {
      const bridge = await connect({
        errlist: [{ code: 'gen.date_range', msg: 'Date range capped' }],
        accounts: [sfinAccount('a1')]
      })
      const result = await api.connection.sync()
      expect(result.lastSyncErrors).toEqual([{ code: 'gen.date_range', msg: 'Date range capped' }])
      expect(result.lastSyncFailure).toBeNull()
      expect(result.lastSyncedAt).toBe(nowSeconds)

      bridge.payload.errlist = []
      const clean = await api.connection.sync()
      expect(clean.lastSyncErrors).toEqual([])
      expect((await api.connection.get())!.lastSyncErrors).toEqual([])
    })

    it('stores an auth failure with no accounts as errors too, so it needs attention', async () => {
      const bridge = await connect({ accounts: [sfinAccount('a1')] })
      await api.connection.sync()

      vi.setSystemTime(new Date(NOW.getTime() + DAY * 1000))
      bridge.payload.accounts = []
      bridge.payload.errlist = [{ code: 'con.auth', msg: 'Bank login revoked' }]
      await expect(guardedSync()).rejects.toThrow('Bank login revoked')

      const failed = (await api.connection.get())!
      expect(failed).toMatchObject({
        lastSyncFailure: 'Bank login revoked',
        lastSyncFailedAt: nowSeconds + DAY,
        lastSyncErrors: [{ code: 'con.auth', msg: 'Bank login revoked' }]
      })
      expect(actionNeededErrors(failed.lastSyncErrors)).toHaveLength(1)
      expect(count('accounts')).toBe(1)

      bridge.payload.accounts = [sfinAccount('a1')]
      bridge.payload.errlist = []
      const recovered = await api.connection.sync()
      expect(recovered).toMatchObject({ lastSyncFailure: null, lastSyncErrors: [] })
    })
  })

  describe('failures', () => {
    it.each([
      ['a 403', { accounts: 403 } as const, /refused access/],
      ['a 500', { accounts: 500 } as const, /HTTP 500/],
      ['a network failure', { accounts: 'network' } as const, /fetch failed/],
      ['junk JSON', { accounts: 'junk' } as const, /./]
    ])(
      '%s is recorded, keeps data and prior warnings, and a later success clears it',
      async (_name, fault, message) => {
        const bridge = await connect({
          errlist: [{ code: 'gen.warn', msg: 'Heads up' }],
          accounts: [sfinAccount('a1', {}, [sfinTxn('t1', '-3.00', noon(2026, 9, 1))])]
        })
        await api.connection.sync()
        const synced = await api.connection.get()

        vi.setSystemTime(new Date(NOW.getTime() + DAY * 1000))
        bridge.fault.accounts = fault.accounts
        await expect(guardedSync()).rejects.toThrow(message)

        const failed = (await api.connection.get())!
        expect(failed.lastSyncFailure).toMatch(message)
        expect(failed.lastSyncFailedAt).toBe(nowSeconds + DAY)
        expect(failed.lastSyncedAt).toBe(synced!.lastSyncedAt)
        expect(failed.lastSyncErrors).toEqual([{ code: 'gen.warn', msg: 'Heads up' }])
        expect(txnsOf('a1')).toHaveLength(1)
        expect(count('accounts')).toBe(1)

        bridge.fault.accounts = undefined
        bridge.payload.errlist = []
        const recovered = await api.connection.sync()
        expect(recovered).toMatchObject({
          lastSyncFailure: null,
          lastSyncFailedAt: null,
          lastSyncErrors: []
        })
      }
    )

    it('records a keychain decrypt failure', async () => {
      await connect({ accounts: [sfinAccount('a1')] })
      accessUrlKeychain.failDecrypt = true
      await expect(api.connection.sync()).rejects.toThrow(/Keychain refused/)
      expect(connectionRow().last_sync_failure).toMatch(/Keychain refused/)
      // the bridge link is best-effort; an unreadable URL just has none
      expect((await api.connection.get())!.bridgeUrl).toBeNull()
    })

    it('syncs past a repeated holding id and an account with no balance-date', async () => {
      const position = {
        id: 'h1',
        symbol: 'A',
        description: 'A',
        currency: 'USD',
        shares: '1',
        market_value: '1.00',
        cost_basis: '1.00',
        purchase_price: '1.00',
        created: 0
      }
      const undated = sfinAccount('undated', { balance: '500.00' }, [
        sfinTxn('u1', '-5.00', noon(2026, 9, 1))
      ])
      delete undated['balance-date']
      await connect({
        accounts: [
          sfinAccount('repeats', { holdings: [position, { ...position, market_value: '2.00' }] }),
          undated
        ]
      })

      await guardedSync()
      expect(
        (await api.accounts.holdings(accountBySfid('repeats').id)).map((h) => h.marketValue)
      ).toEqual([1000])
      expect(accountBySfid('undated')).toMatchObject({ balance: 500_000, balance_date: nowSeconds })
      expect((await api.accounts.get(accountBySfid('undated').id))!.balance).toBe(500_000)
    })
  })

  describe('transfer detection and rules', () => {
    const pair = (): SfinAccountSet['accounts'] => [
      sfinAccount('checking', {}, [
        sfinTxn('out', '-50.00', noon(2026, 9, 10), { description: 'Move money' })
      ]),
      sfinAccount('savings', {}, [
        sfinTxn('in', '50.00', noon(2026, 9, 10), { description: 'Move money' })
      ])
    ]

    it('files a detected pair under Transfers when detectTransfers is on', async () => {
      await connect({ accounts: pair() })
      const result = await guardedSync()
      expect(result.detectedTransfers).toBe(1)
      const transfers = systemCategory('transfers')
      expect([...txnsOf('checking'), ...txnsOf('savings')].map((t) => t.category_id)).toEqual([
        transfers,
        transfers
      ])
      expect(count('action_log', "source = 'detector'")).toBeGreaterThan(0)
    })

    it('leaves the pair alone when detectTransfers is off', async () => {
      await api.settings.set('detectTransfers', false)
      await connect({ accounts: pair() })
      const result = await guardedSync()
      expect(result.detectedTransfers).toBe(0)
      expect([...txnsOf('checking'), ...txnsOf('savings')].map((t) => t.category_id)).toEqual([
        null,
        null
      ])
    })

    const coffee = (): SfinAccountSet['accounts'] => [
      sfinAccount('a1', {}, [
        sfinTxn('c1', '-4.50', noon(2026, 9, 11), { description: 'Blue Bottle Coffee' })
      ])
    ]

    it('applies rules when applyRulesOnSync is on', async () => {
      const food = category()
      rule('Coffee', 'coffee', food)
      await connect({ accounts: coffee() })
      const result = await guardedSync()
      expect(result.rulesApplied).toBe(1)
      expect(txnsOf('a1')[0].category_id).toBe(food)
    })

    it('does not apply rules when applyRulesOnSync is off', async () => {
      await api.settings.set('applyRulesOnSync', false)
      rule('Coffee', 'coffee', category())
      await connect({ accounts: coffee() })
      const result = await guardedSync()
      expect(result.rulesApplied).toBe(0)
      expect(txnsOf('a1')[0].category_id).toBeNull()
    })

    it('the detector runs before rules, so a transfer leg is not re-filed by a matching rule', async () => {
      const other = category('Moves')
      rule('Move', 'move money', other)
      await connect({ accounts: pair() })
      const result = await guardedSync()
      expect(result).toMatchObject({ detectedTransfers: 1, rulesApplied: 0 })
    })
  })

  describe('action log', () => {
    it('a sync that changes nothing in the log creates no run', async () => {
      await connect({
        accounts: [sfinAccount('a1', {}, [sfinTxn('t1', '-3.00', noon(2026, 9, 1))])]
      })
      const runs = count('action_runs')
      await guardedSync()
      await guardedSync()
      expect(count('action_runs')).toBe(runs)
    })

    it('groups its detector and rule entries into one sync run', async () => {
      const food = category()
      rule('Coffee', 'coffee', food)
      const runs = count('action_runs')
      await connect({
        accounts: [
          sfinAccount('checking', {}, [
            sfinTxn('out', '-50.00', noon(2026, 9, 10)),
            sfinTxn('c1', '-4.50', noon(2026, 9, 11), { description: 'Coffee' })
          ]),
          sfinAccount('savings', {}, [sfinTxn('in', '50.00', noon(2026, 9, 10))])
        ]
      })
      await guardedSync()
      expect(count('action_runs')).toBe(runs + 1)
      const run = query<{ id: number; trigger: string }>(
        'SELECT id, trigger FROM action_runs ORDER BY id DESC LIMIT 1'
      )[0]
      expect(run.trigger).toBe('sync')
      expect(
        query<{ source: string }>(
          `SELECT source FROM action_log WHERE run_id = ${run.id} ORDER BY id`
        ).map((e) => e.source)
      ).toEqual(['detector', 'rule'])
    })
  })

  it('is idempotent: repeating a sync changes no rows', async () => {
    await connect({
      accounts: [
        sfinAccount('a1', { balance: '80.00' }, [
          sfinTxn('t1', '-3.00', noon(2026, 9, 1)),
          sfinTxn('p1', '-1.00', 0, { pending: true })
        ])
      ]
    })
    const state = (): unknown[] => [
      query('SELECT * FROM accounts'),
      query('SELECT * FROM transactions ORDER BY simplefin_id').map(({ id, ...row }) => ({
        ...row,
        id: id === undefined ? id : 'x'
      })),
      count('action_log')
    ]
    await guardedSync()
    const first = state()
    const second = await guardedSync()
    expect(state()).toEqual(first)
    expect(second).toMatchObject({ detectedTransfers: 0, rulesApplied: 0, matchedImports: 0 })
  })

  it('keeps a deleted synced account deleted while syncing the rest', async () => {
    await connect({
      accounts: [
        sfinAccount('keep', {}, [sfinTxn('k1', '-1.00', noon(2026, 9, 1))]),
        sfinAccount('drop', {}, [sfinTxn('d1', '-2.00', noon(2026, 9, 1))])
      ]
    })
    await api.connection.sync()
    await api.accounts.delete(accountBySfid('drop').id)

    await guardedSync()
    expect(accountBySfid('drop')).toBeUndefined()
    expect(txnsOf('drop')).toEqual([])
    expect(txnsOf('keep')).toHaveLength(1)
  })

  it('keeps a deleted account deleted across a disconnect and reconnect', async () => {
    const accounts = [sfinAccount('keep'), sfinAccount('drop')]
    await connect({ accounts })
    await api.connection.sync()
    await api.accounts.delete(accountBySfid('drop').id)

    await api.connection.disconnect()
    await connect({ accounts })
    await guardedSync()
    expect(accountBySfid('drop')).toBeUndefined()
    expect(accountBySfid('keep')).toBeDefined()
  })

  it('keeps a detached account deleted once it is deleted while disconnected', async () => {
    const accounts = [sfinAccount('detached')]
    await connect({ accounts })
    await api.connection.sync()
    await api.connection.disconnect()
    await api.accounts.delete(accountBySfid('detached').id)

    await connect({ accounts })
    await guardedSync()
    expect(accountBySfid('detached')).toBeUndefined()
  })
})

describe('sync guard', () => {
  it('a category the user set survives a re-sync of the same transaction, even when the bank changes it', async () => {
    const bridge = await connect({
      accounts: [
        sfinAccount('a1', {}, [
          sfinTxn('t1', '-9.99', noon(2026, 9, 1), { description: 'Old name' })
        ])
      ]
    })
    await api.connection.sync()
    const id = query<{ id: number }>("SELECT id FROM transactions WHERE simplefin_id = 't1'")[0].id
    const mine = category('Chosen by hand')
    await api.transactions.setCategories({ changes: [{ transactionId: id, categoryId: mine }] })

    bridge.payload.accounts = [
      sfinAccount('a1', {}, [
        sfinTxn('t1', '-10.99', noon(2026, 9, 2), { description: 'New name' })
      ])
    ]
    await guardedSync()
    expect(categoryOf(id)).toBe(mine)
    expect(query('SELECT description, amount FROM transactions WHERE id = ' + id)).toEqual([
      { description: 'New name', amount: -10_990 }
    ])
  })

  it('a soft delete survives a re-sync and the row is not revived or duplicated', async () => {
    const bridge = await connect({
      accounts: [sfinAccount('a1', {}, [sfinTxn('t1', '-9.99', noon(2026, 9, 1))])]
    })
    await api.connection.sync()
    const id = query<{ id: number }>("SELECT id FROM transactions WHERE simplefin_id = 't1'")[0].id
    await api.transactions.bulkDelete({ transactionIds: [id] })
    const deletedAt = query<{ d: number }>(
      `SELECT deleted_at AS d FROM transactions WHERE id = ${id}`
    )[0].d
    expect(deletedAt).toBeGreaterThan(0)

    bridge.payload.accounts = [
      sfinAccount('a1', {}, [
        sfinTxn('t1', '-9.99', noon(2026, 9, 1), { description: 'Edited upstream' })
      ])
    ]
    await guardedSync()
    expect(txnsOf('a1')).toMatchObject([{ id: 't1', deleted_at: deletedAt }])
  })

  it('a detector pass over a user-categorized leg does not take it', async () => {
    const mine = category('Mine')
    await connect({
      accounts: [
        sfinAccount('checking', {}, [sfinTxn('out', '-50.00', noon(2026, 9, 10))]),
        sfinAccount('savings', {}, [sfinTxn('in', '50.00', noon(2026, 9, 10))])
      ]
    })
    await api.settings.set('detectTransfers', false)
    await api.connection.sync()
    const out = query<{ id: number }>("SELECT id FROM transactions WHERE simplefin_id = 'out'")[0]
      .id
    await api.transactions.setCategories({ changes: [{ transactionId: out, categoryId: mine }] })

    await api.settings.set('detectTransfers', true)
    await guardedSync()
    expect(categoryOf(out)).toBe(mine)
  })

  it('catches a sync that rewrites a category or a delete behind the log', () => {
    const a = account()
    const t = txn(a)
    const gone = txn(a)
    const cat = category()

    const assertCategory = beginSyncGuard()
    query(`UPDATE transactions SET category_id = ${cat} WHERE id = ${t}`)
    expect(() => assertCategory()).toThrow(/without a matching detector\/rule entry/)
    query(`UPDATE transactions SET category_id = NULL WHERE id = ${t}`)

    const assertDeleted = beginSyncGuard()
    query(`UPDATE transactions SET deleted_at = 1 WHERE id = ${gone}`)
    expect(() => assertDeleted()).toThrow(/changed deleted_at/)
  })
})

describe('accounts', () => {
  it('derives balance from the anchor plus settled, live rows strictly after its date', async () => {
    const anchorDate = noon(2026, 9, 10)
    const a = account({ name: 'Anchored', balance: 1_000_000, balanceDate: anchorDate })
    txn(a, { posted: noon(2026, 9, 9), amount: -999_000 })
    // dated exactly at the anchor: already baked into it
    txn(a, { posted: anchorDate, amount: -888_000 })
    txn(a, { posted: noon(2026, 9, 11), amount: -25_000 })
    txn(a, { posted: noon(2026, 9, 12), amount: 5_000 })
    txn(a, { posted: noon(2026, 9, 13), amount: -777_000, pending: true })
    txn(a, { posted: noon(2026, 9, 14), amount: -666_000, deletedAt: noon(2026, 9, 15) })

    const listed = (await api.accounts.list()).find((x) => x.id === a)!
    expect(listed.balance).toBe(980_000)
    expect(listed.reportedBalance).toBe(1_000_000)
    expect((await api.accounts.get(a))!.balance).toBe(980_000)
  })

  it('counts every dated row on a manual account', async () => {
    const a = account({ name: 'Manual', balance: 50_000 })
    txn(a, { posted: noon(2020, 1, 1), amount: -10_000 })
    txn(a, { posted: noon(2026, 9, 1), amount: 4_000 })
    txn(a, { posted: noon(2026, 9, 2), amount: -1, pending: true })
    expect((await api.accounts.get(a))!.balance).toBe(44_000)
  })

  it('get is null for a missing account and reports the holdings count', async () => {
    expect(await api.accounts.get(987_654)).toBeNull()
    await connect({
      accounts: [
        sfinAccount('inv', {
          holdings: [
            {
              id: 'h1',
              symbol: 'A',
              description: 'A',
              currency: 'USD',
              shares: '1',
              market_value: '1.00',
              cost_basis: '1.00',
              purchase_price: '1.00',
              created: 0
            }
          ]
        })
      ]
    })
    await api.connection.sync()
    expect((await api.accounts.get(accountBySfid('inv').id))!.holdingsCount).toBe(1)
  })

  it('rename trims and survives a sync', async () => {
    const bridge = await connect({ accounts: [sfinAccount('a1', { name: 'Bank name' })] })
    await api.connection.sync()
    const id = accountBySfid('a1').id
    await api.accounts.rename(id, '  My checking  ')
    expect((await api.accounts.get(id))!.name).toBe('My checking')

    bridge.payload.accounts = [sfinAccount('a1', { name: 'Bank renamed it' })]
    await api.connection.sync()
    expect((await api.accounts.get(id))!.name).toBe('My checking')
  })

  it('rename rejects a blank name', async () => {
    const a = account({ name: 'Keep me' })
    await expect(api.accounts.rename(a, '   ')).rejects.toThrow()
    expect((await api.accounts.get(a))!.name).toBe('Keep me')
  })

  it('rename rejects a missing account, like delete', async () => {
    await expect(api.accounts.rename(999_999, 'Ghost')).rejects.toThrow('Account not found')
    expect(count('accounts', "name = 'Ghost'")).toBe(0)
  })
  it('delete of a missing account errors', async () => {
    await expect(api.accounts.delete(987_654)).rejects.toThrow('Account not found')
  })

  it('delete cascades the account transactions and holdings only', async () => {
    await connect({
      accounts: [
        sfinAccount(
          'gone',
          {
            holdings: [
              {
                id: 'h1',
                symbol: 'A',
                description: 'A',
                currency: 'USD',
                shares: '1',
                market_value: '1.00',
                cost_basis: '1.00',
                purchase_price: '1.00',
                created: 0
              }
            ]
          },
          [sfinTxn('t1', '-1.00', noon(2026, 9, 1))]
        ),
        sfinAccount('stays', {}, [sfinTxn('t2', '-2.00', noon(2026, 9, 1))])
      ]
    })
    await api.connection.sync()
    const gone = accountBySfid('gone').id

    await api.accounts.delete(gone)
    expect(count('accounts', `id = ${gone}`)).toBe(0)
    expect(count('transactions', `account_id = ${gone}`)).toBe(0)
    expect(count('holdings', `account_id = ${gone}`)).toBe(0)
    expect(txnsOf('stays')).toHaveLength(1)
  })

  it('lists holdings by market value, largest first', async () => {
    const holding = (
      id: string,
      value: string
    ): SfinAccountSet['accounts'][number]['holdings'][number] => ({
      id,
      symbol: id,
      description: id,
      currency: 'USD',
      shares: '1',
      market_value: value,
      cost_basis: '0',
      purchase_price: '0',
      created: 0
    })
    await connect({
      accounts: [
        sfinAccount('inv', {
          holdings: [holding('small', '5.00'), holding('big', '900.00'), holding('mid', '70.00')]
        })
      ]
    })
    await api.connection.sync()
    const held = await api.accounts.holdings(accountBySfid('inv').id)
    expect(held.map((h) => h.simplefinId)).toEqual(['big', 'mid', 'small'])
  })
})
