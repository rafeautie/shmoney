import { describe, expect, it } from 'vitest'
import { runBalances } from './balances'
import { fixtureContext, fixtureDb, fixtureTransactions } from './test-fixture'

const round2 = (n: number): number => Math.round(n * 100) / 100

// every seeded account anchors at balance_date 0, so all its rows add on
const STORED: Record<number, number> = { 1: 4200, 2: 26000, 3: -1350 }
const balance = (account: number): number =>
  round2(
    STORED[account] +
      fixtureTransactions()
        .filter((t) => t.account === account)
        .reduce((s, t) => s + t.amount, 0)
  )
const change30 = (account: number): number =>
  round2(
    fixtureTransactions()
      .filter((t) => t.account === account && t.day >= '2026-08-26' && t.day <= '2026-09-24')
      .reduce((s, t) => s + t.amount, 0)
  )

describe('balances tool', () => {
  it('lists every account with net worth, assets and debts', () => {
    const out = runBalances({ account: null, chart: 'auto' }, fixtureContext())
    expect(out.result.ok).toBe(true)
    const [checking, savings, visa] = [balance(1), balance(2), balance(3)]
    expect(visa).toBeLessThan(0)
    expect(out.result.facts).toEqual({
      net_worth: round2(checking + savings + visa),
      assets: round2(checking + savings),
      debts: round2(-visa),
      accounts: 3
    })
    expect(out.result.rows).toEqual([
      ['Everyday Checking', checking, 'asset', change30(1), null],
      ['High-Yield Savings', savings, 'asset', change30(2), 'Trip to Japan, Emergency fund'],
      ['Rewards Visa', visa, 'debt', change30(3), null]
    ])
    expect(out.chart).toMatchObject({ type: 'bar', x: 'account', series: ['balance'] })
  })

  it('reports one account', () => {
    const out = runBalances({ account: 'High-Yield Savings', chart: 'auto' }, fixtureContext())
    expect(out.result.facts).toEqual({
      account: 'High-Yield Savings',
      balance: balance(2),
      kind: 'asset',
      change_30d: 500,
      funds_goals: 'Trip to Japan, Emergency fund'
    })
    expect(out.chart).toBeNull()
  })

  it('fails on an unknown account', () => {
    const out = runBalances({ account: 'Brokerage', chart: 'auto' }, fixtureContext())
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toMatch(/Everyday Checking/)
  })

  it('keeps currencies apart', () => {
    const db = fixtureDb()
    db.exec(
      "INSERT INTO main.accounts (id, name, currency, balance, available_balance, balance_date) VALUES (4, 'Euro Account', 'EUR', 1000000, NULL, 0)"
    )
    const out = runBalances({ account: null, chart: 'auto' }, fixtureContext(db))
    expect(out.result.facts).toMatchObject({
      EUR: { net_worth: 1000, assets: 1000, debts: 0, accounts: 1 },
      USD: { accounts: 3 }
    })
    expect(out.result.notes?.[0]).toMatch(/USD and EUR/)
    expect(out.result.columns).toContain('currency')
  })
})
