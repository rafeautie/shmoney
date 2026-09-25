import { SAVINGS_GOALS_TEMPLATE, SPENDING_OVERVIEW_TEMPLATE } from '@shared/report-templates'
import { AccountDraft, cents, dayAt, random, type Day } from './generate'
import { usd } from './format'
import type { DatasetDefinition } from './types'

// A single-paycheck household a year into tracking: checking,
// savings, a credit card and a brokerage account, with rent, bills, card
// autopay and savings sweeps that exercise transfer detection. This is the
// dataset the screenshots are shot from.

const HISTORY_DAYS = 365

const GROCERS = ["TRADER JOE'S #552", 'SAFEWAY #1234', 'WHOLE FOODS MKT #10233']
const DINING: [string, number, number][] = [
  ['BLUE BOTTLE COFFEE', 5, 14],
  ['CHIPOTLE 2291', 11, 24],
  ['SQ *TACOS EL GORDO', 14, 32],
  ['DOORDASH*THAI BASIL', 28, 58],
  ['SWEETGREEN MISSION', 13, 19]
]

function accountSet(now: Date): ReturnType<DatasetDefinition['accountSet']> {
  const checking = new AccountDraft('demo-chk', 'Everyday Checking', 'demo-evergreen', 4_812_40)
  const savings = new AccountDraft('demo-sav', 'High-Yield Savings', 'demo-evergreen', 16_250_00)
  const card = new AccountDraft('demo-visa', 'Rewards Visa', 'demo-summit', 0)
  const brokerage = new AccountDraft('demo-brk', 'Individual Brokerage', 'demo-northwind', 0)

  const days: Day[] = []
  for (let offset = -HISTORY_DAYS; offset <= 0; offset++) days.push(dayAt(now, offset))

  for (const day of days) {
    const rng = random(`household:${day.key}`)
    const chance = (p: number): boolean => rng() < p
    const lastDay = day.date === day.daysInMonth

    // checking: income, fixed bills and the transfers the detector pairs up
    if (day.date === 1 || day.date === 15) {
      checking.add(day, 'payroll', 'ACME CORP PAYROLL PPD', 3_284_17)
    }
    if (day.date === 1) {
      checking.add(day, 'rent', 'ZELLE PAYMENT TO OAKWOOD PROPERTIES', -2_450_00)
    }
    if (day.date === 3) {
      checking.add(day, 'invest', 'NORTHWIND INVEST ACH', -400_00)
      brokerage.add(day, 'deposit', 'ACH DEPOSIT EVERGREEN BANK', 400_00)
    }
    if (day.date === 8) checking.add(day, 'insurance', 'STATE FARM INSURANCE', -142_50)
    if (day.date === 12) {
      // heating and cooling months cost more
      const seasonal = [1, 2, 7, 8, 12].includes(day.month) ? 60 : 0
      checking.add(day, 'power', 'PGANDE WEB ONLINE', -cents(rng, 85 + seasonal, 120 + seasonal))
    }
    if (day.date === 16) {
      checking.add(day, 'save', 'ONLINE TRANSFER TO SAVINGS 4417', -750_00)
      savings.add(day, 'save', 'ONLINE TRANSFER FROM CHECKING 0921', 750_00)
    }
    if (day.date === 18) checking.add(day, 'internet', 'COMCAST XFINITY', -79_99)
    if (day.date === 22) {
      // autopay the card's previous calendar month in full
      const prev = new Date(day.year, day.month - 2, 1)
      const from = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}01`
      const to = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}31`
      const statement = -card.total(from, to, (t) => t.slug !== 'payment')
      if (statement > 0) {
        checking.add(day, 'cardpay', 'RWRDS VISA AUTOPAY', -statement)
        card.add(day, 'payment', 'AUTOPAY PAYMENT - THANK YOU', statement)
      }
    }
    if (lastDay) {
      savings.add(day, 'interest', 'INTEREST PAYMENT', cents(rng, 58, 74))
    }
    if (lastDay && [3, 6, 9, 12].includes(day.month)) {
      brokerage.add(day, 'dividend', 'DIVIDEND RECEIVED VTI', cents(rng, 38, 62))
    }

    // card: day-to-day spending
    if (chance(0.3)) {
      const grocer = GROCERS[Math.floor(rng() * GROCERS.length)]
      card.add(day, 'grocery', grocer, -cents(rng, 26, 148))
    }
    if (chance(day.weekday === 5 || day.weekday === 6 ? 0.55 : 0.3)) {
      const [name, min, max] = DINING[Math.floor(rng() * DINING.length)]
      card.add(day, 'dining', name, -cents(rng, min, max))
    }
    if (day.date === 5) card.add(day, 'netflix', 'NETFLIX.COM', -15_49)
    if (day.date === 9) card.add(day, 'spotify', 'SPOTIFY USA', -11_99)
    if (day.date === 14) card.add(day, 'icloud', 'APPLE.COM/BILL', -2_99)
    if (day.date === 20) card.add(day, 'news', 'NYTIMES DIGITAL', -4_00)
    if (chance(0.11)) card.add(day, 'gas', 'SHELL OIL 57442', -cents(rng, 38, 66))
    if (chance(0.12)) card.add(day, 'uber', 'UBER *TRIP', -cents(rng, 11, 34))
    // December shopping runs hot
    if (chance(day.month === 12 ? 0.35 : 0.14)) {
      card.add(day, 'amazon', 'AMAZON.COM*RT4K21', -cents(rng, 12, 96))
    }
    if (chance(0.06)) card.add(day, 'target', 'TARGET T-2766', -cents(rng, 24, 88))
    if (chance(0.035)) card.add(day, 'movies', 'AMC THEATRES 2114', -cents(rng, 26, 44))
    if (chance(0.025)) card.add(day, 'rei', 'REI #45 BERKELEY', -cents(rng, 38, 210))
    if (chance(0.035)) card.add(day, 'pharmacy', 'CVS/PHARMACY #9912', -cents(rng, 8, 42))
  }

  const created = days[0].posted
  return {
    errlist: [],
    connections: [
      { conn_id: 'demo-evergreen', name: 'Evergreen Bank' },
      { conn_id: 'demo-summit', name: 'Summit Card Services' },
      { conn_id: 'demo-northwind', name: 'Northwind Investments' }
    ],
    accounts: [
      checking.render(now),
      savings.render(now),
      // the last two days' card swipes haven't posted yet
      card.render(now, { pendingAfter: dayAt(now, -2).key }),
      brokerage.render(now, {
        balance: 48_906_12,
        holdings: [
          {
            symbol: 'VTI',
            description: 'Vanguard Total Stock Market ETF',
            shares: 98.4172,
            marketValue: 31_412_55,
            costBasis: 26_880_00,
            created
          },
          {
            symbol: 'VXUS',
            description: 'Vanguard Total International Stock ETF',
            shares: 142.0551,
            marketValue: 9_873_02,
            costBasis: 9_120_00,
            created
          },
          {
            symbol: 'BND',
            description: 'Vanguard Total Bond Market ETF',
            shares: 104.2208,
            marketValue: 7_620_55,
            costBasis: 7_700_00,
            created
          }
        ]
      })
    ]
  }
}

const DINING_OUT = '🍽️ Dining Out'
const GROCERIES = '🛒 Groceries'

export const household: DatasetDefinition = {
  id: 'household',
  name: 'Household',
  description:
    'A year of checking, savings, a credit card and investments, with budgets, reports and rules.',
  accountSet,
  rules: [
    { name: 'Paycheck', phrases: ['ACME CORP PAYROLL'], category: { system: 'income' } },
    { name: 'Rent', phrases: ['OAKWOOD PROPERTIES'], category: '🏠 Housing' },
    { name: 'Groceries', phrases: ["TRADER JOE'S", 'SAFEWAY', 'WHOLE FOODS'], category: GROCERIES },
    {
      name: 'Streaming and apps',
      phrases: ['NETFLIX', 'SPOTIFY', 'APPLE.COM/BILL', 'NYTIMES'],
      category: '📺 Subscriptions'
    },
    { name: 'Utilities', phrases: ['PGANDE', 'COMCAST'], category: '💡 Utilities' },
    { name: 'Fuel', phrases: ['SHELL OIL'], category: '🚗 Transportation' },
    { name: 'Insurance', phrases: ['STATE FARM'], category: '🛡️ Insurance' },
    {
      name: 'Interest and dividends',
      phrases: ['INTEREST PAYMENT', 'DIVIDEND'],
      category: { system: 'income' }
    }
  ],
  manual: {
    olderThanDays: 18,
    entries: [
      { phrase: 'BLUE BOTTLE', category: DINING_OUT },
      { phrase: 'CHIPOTLE', category: DINING_OUT },
      { phrase: 'TACOS EL GORDO', category: DINING_OUT },
      { phrase: 'DOORDASH', category: DINING_OUT },
      { phrase: 'SWEETGREEN', category: DINING_OUT },
      { phrase: 'UBER', category: '🚗 Transportation' },
      { phrase: 'AMAZON', category: '🛍️ Shopping' },
      { phrase: 'TARGET', category: '🛍️ Shopping' },
      { phrase: 'AMC THEATRES', category: '🎬 Entertainment' },
      { phrase: 'REI #', category: '🎨 Hobbies' },
      { phrase: 'CVS/PHARMACY', category: '⚕️ Healthcare' }
    ]
  },
  budgets: [
    { category: '🏠 Housing', fills: [{ monthsAgo: 11, amount: 2450 }] },
    {
      category: GROCERIES,
      fills: [
        { monthsAgo: 11, amount: 750 },
        { monthsAgo: 3, amount: 850 }
      ]
    },
    { category: DINING_OUT, fills: [{ monthsAgo: 11, amount: 280 }] },
    { category: '💡 Utilities', fills: [{ monthsAgo: 11, amount: 240 }] },
    { category: '🚗 Transportation', fills: [{ monthsAgo: 11, amount: 280 }] },
    { category: '🛍️ Shopping', fills: [{ monthsAgo: 11, amount: 350 }] },
    { category: '📺 Subscriptions', fills: [{ monthsAgo: 11, amount: 40 }] },
    { category: '🛡️ Insurance', fills: [{ monthsAgo: 11, amount: 145 }] },
    { category: '🎬 Entertainment', fills: [{ monthsAgo: 11, amount: 60 }] },
    { category: '⚕️ Healthcare', fills: [{ monthsAgo: 11, amount: 40 }] },
    { category: '🎨 Hobbies', fills: [{ monthsAgo: 11, amount: 75 }] }
  ],
  reports: [
    SPENDING_OVERVIEW_TEMPLATE,
    {
      name: 'Monthly Check-in',
      filters: {
        dateRange: { kind: 'relative', unit: 'month', count: 6, includeCurrent: true },
        direction: 'all',
        includePending: true,
        includeTransfers: false
      },
      widgets: [
        {
          title: 'Net by month',
          type: 'bar',
          config: {
            query: {
              source: 'transactions',
              measure: 'sum',
              groupBy: 'none',
              timeGrain: 'month',
              cumulative: false
            },
            filters: { mode: 'inherit', overrides: {} }
          },
          x: 0,
          y: 0,
          w: 6,
          h: 5
        },
        {
          title: 'Envelopes',
          type: 'budget',
          config: {
            query: {
              source: 'transactions',
              measure: 'expense',
              groupBy: 'category',
              timeGrain: 'none',
              cumulative: false
            },
            filters: { mode: 'inherit', overrides: {} },
            display: { budgetView: 'bars' }
          },
          x: 6,
          y: 0,
          w: 6,
          h: 5
        },
        {
          title: 'Food: groceries vs. dining out',
          type: 'area',
          categories: [GROCERIES, DINING_OUT],
          config: {
            query: {
              source: 'transactions',
              measure: 'expense',
              groupBy: 'category',
              timeGrain: 'month',
              cumulative: false
            },
            filters: { mode: 'inherit', overrides: {} },
            display: { stacked: true, showLegend: true }
          },
          x: 0,
          y: 5,
          w: 8,
          h: 5
        },
        {
          title: 'Top categories',
          type: 'summaryTable',
          config: {
            query: {
              source: 'transactions',
              measure: 'expense',
              groupBy: 'category',
              timeGrain: 'none',
              cumulative: false,
              limit: 8
            },
            filters: { mode: 'inherit', overrides: {} }
          },
          x: 8,
          y: 5,
          w: 4,
          h: 5
        }
      ]
    },
    SAVINGS_GOALS_TEMPLATE
  ],
  goals: [
    {
      name: 'Emergency fund',
      mode: 'balance',
      accounts: ['High-Yield Savings'],
      target: 30_000,
      startedMonthsAgo: 8,
      targetMonthsAhead: 9
    },
    {
      name: 'Trip to Japan',
      mode: 'contributions',
      accounts: ['High-Yield Savings'],
      target: 6_000,
      startedMonthsAgo: 5
    },
    {
      name: 'House down payment',
      mode: 'contributions',
      accounts: ['Individual Brokerage'],
      target: 25_000,
      startedMonthsAgo: 10,
      targetMonthsAhead: 26
    }
  ],
  savedFilters: [
    {
      name: 'Eating out, last 90 days',
      filters: {
        dateRange: { kind: 'relative', unit: 'day', count: 90, includeCurrent: true },
        direction: 'expense',
        includePending: true,
        includeTransfers: false,
        categories: [DINING_OUT]
      }
    },
    {
      name: 'Big purchases',
      filters: {
        dateRange: { kind: 'all' },
        direction: 'expense',
        includePending: true,
        includeTransfers: false,
        amountMin: 150_000
      }
    }
  ],
  suggestions: [{ phrase: 'TACOS EL GORDO', category: DINING_OUT }],
  chats: [
    {
      question: 'What were my top spending categories last month?',
      hoursAgo: 30,
      answer(turn) {
        turn.think(
          'The user wants last month broken down by category. totals does exactly that: spending by category over last_month, and it draws the chart itself.'
        )
        const { result } = turn.tool('totals', {
          measure: 'spending',
          by: 'category',
          split: 'none',
          period: 'last_month',
          compare_to: null,
          category: null,
          account: null,
          search: null,
          chart: 'auto'
        })
        const rows = (result.rows ?? []) as [string, number][]
        const total = Number(result.facts?.total_spending ?? 0)
        const top = rows.filter(([name]) => name !== 'Other').slice(0, 3)
        turn.say(
          [
            `You spent ${usd(total)} last month. The biggest categories were:`,
            '',
            ...top.map(([name, value], i) => `${i + 1}. **${name}**: ${usd(value)}`),
            '',
            `Housing is fixed, so ${top[1]?.[0] ?? 'the next category'} is where there's the most room to adjust.`
          ].join('\n')
        )
      }
    },
    {
      question: 'Chart my income versus spending by month',
      hoursAgo: 2,
      answer(turn) {
        turn.think(
          'I need money in and money out per month. totals with measure net by month returns income and spending columns beside net, and its facts average the complete months, so I chart the two columns as bars.'
        )
        const { result } = turn.tool('totals', {
          measure: 'net',
          by: 'month',
          split: 'none',
          period: 'last_12_months',
          compare_to: null,
          category: null,
          account: null,
          search: null,
          chart: 'none'
        })
        turn.chart({
          type: 'bar',
          title: 'Income vs. spending by month',
          x: 'month',
          series: ['income', 'spending'],
          group: null
        })
        const facts = result.facts ?? {}
        const highest = facts.highest_complete_month as { month: string; net: number } | undefined
        const lowest = facts.lowest_complete_month as { month: string; net: number } | undefined
        turn.say(
          [
            `Over the last 12 complete months you kept ${usd(Number(facts.total_net ?? 0))} after spending, ${facts.savings_rate_percent ?? 0}% of what came in, or about ${usd(Number(facts.average_per_complete_month ?? 0))} a month.`,
            '',
            highest && lowest
              ? `Your best month was **${highest.month}** at ${usd(highest.net)}, and the tightest was **${lowest.month}** at ${usd(lowest.net)}.`
              : ''
          ].join('\n')
        )
      }
    }
  ],
  settings: { onboardingComplete: true }
}
