import { z } from 'zod'
import { createLogger } from './logging'

// SimpleFIN protocol v2 (https://www.simplefin.org/protocol.html), requested
// via ?version=2. errlist/connections default to [] so a server that ignores
// the version param doesn't crash the parser.

const log = createLogger('simplefin')

/**
 * A fatal errlist response. The message (shown to the user) can name their
 * institutions, so loggers must record `codes` and never the message.
 */
export class SfinErrlistError extends Error {
  readonly codes: string[]

  constructor(errlist: { code: string; msg: string }[]) {
    super(errlist.map((e) => e.msg).join('; '))
    this.name = 'SfinErrlistError'
    this.codes = errlist.map((e) => e.code)
  }
}

const sfinTransactionSchema = z.looseObject({
  id: z.string(),
  posted: z.number(),
  amount: z.string(),
  description: z.string(),
  pending: z.boolean().optional(),
  transacted_at: z.number().optional()
})

const sfinHoldingSchema = z.looseObject({
  id: z.string(),
  symbol: z.string().default(''),
  description: z.string().default(''),
  currency: z.string().default(''),
  shares: z.string(),
  market_value: z.string(),
  cost_basis: z.string().default('0'),
  purchase_price: z.string().default('0'),
  created: z.number().default(0)
})

const sfinAccountSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  conn_id: z.string().optional(),
  currency: z.string(),
  balance: z.string(),
  'available-balance': z.string().optional(),
  'balance-date': z.number(),
  transactions: z.array(sfinTransactionSchema).default([]),
  holdings: z.array(sfinHoldingSchema).default([])
})

const sfinConnectionSchema = z.looseObject({
  conn_id: z.string(),
  name: z.string()
})

const accountSetSchema = z.looseObject({
  errlist: z.array(z.looseObject({ code: z.string(), msg: z.string() })).default([]),
  connections: z.array(sfinConnectionSchema).default([]),
  accounts: z.array(sfinAccountSchema)
})

export type SfinAccountSet = z.infer<typeof accountSetSchema>

/** Decimal string -> integer milliunits (value * 1000), exact for 0-3 decimal currencies. */
export function parseAmount(value: string): number {
  const milliunits = Math.round(Number(value) * 1000)
  if (!Number.isFinite(milliunits)) {
    throw new Error(`SimpleFIN returned an unparseable amount: "${value}"`)
  }
  return milliunits
}

export async function claimAccessUrl(setupToken: string): Promise<string> {
  let claimUrl: URL
  try {
    claimUrl = new URL(Buffer.from(setupToken, 'base64').toString('utf8'))
  } catch {
    throw new Error('Setup token is not valid (expected a base64-encoded claim URL)')
  }
  if (claimUrl.protocol !== 'https:') {
    throw new Error('Setup token must decode to an https URL')
  }

  const response = await fetch(claimUrl, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`SimpleFIN claim failed (HTTP ${response.status})`)
  }

  const accessUrl = (await response.text()).trim()
  try {
    const parsed = new URL(accessUrl)
    if (!parsed.username || !parsed.password) throw new Error()
  } catch {
    throw new Error('SimpleFIN claim did not return a valid access URL')
  }
  return accessUrl
}

export async function fetchAccounts(accessUrl: string, startDate: number): Promise<SfinAccountSet> {
  // fetch() rejects URLs with embedded credentials, so move them to a header
  const url = new URL(accessUrl)
  const basic = Buffer.from(
    `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
  ).toString('base64')
  url.username = ''
  url.password = ''
  url.pathname = `${url.pathname.replace(/\/$/, '')}/accounts`
  url.search = `?version=2&start-date=${startDate}&pending=1`

  const response = await fetch(url, { headers: { Authorization: `Basic ${basic}` } })
  if (!response.ok) {
    throw new Error(`SimpleFIN accounts request failed (HTTP ${response.status})`)
  }

  const payload = accountSetSchema.parse(await response.json())
  if (payload.errlist.length > 0) {
    // The bridge reports non-fatal warnings here too (e.g. "date range capped"),
    // so only treat errors as fatal when no account data came back.
    if (payload.accounts.length === 0) {
      throw new SfinErrlistError(payload.errlist)
    }
    // codes only: bridge messages can name the user's institutions
    log.warn('accounts.errlist', { codes: payload.errlist.map((e) => e.code).join(',') })
  }
  return payload
}
