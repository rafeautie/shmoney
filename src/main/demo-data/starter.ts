import { AccountDraft, cents, dayAt, random } from './generate'
import type { DatasetDefinition } from './types'

// Two months of a freshly connected bank and nothing organized yet: every row
// is uncategorized, so it shows categorizing by hand, rule suggestions
// forming from repeats, and building a first budget from scratch.

const HISTORY_DAYS = 60

const MERCHANTS: [string, string, number, number, number][] = [
  // [slug, description, daily chance, min, max]
  ['coffee', 'STARBUCKS STORE 08812', 0.35, 4, 9],
  ['grocery', 'KROGER #0421', 0.2, 22, 118],
  ['lunch', 'PANERA BREAD #6021', 0.12, 11, 19],
  ['gas', 'CHEVRON 0093321', 0.1, 34, 58],
  ['amazon', 'AMAZON.COM*MK1Q8', 0.12, 9, 74],
  ['rideshare', 'LYFT *RIDE', 0.08, 9, 28]
]

function accountSet(now: Date): ReturnType<DatasetDefinition['accountSet']> {
  const checking = new AccountDraft('demo-start-chk', 'Checking', 'demo-riverstone', 2_140_55)
  const card = new AccountDraft('demo-start-card', 'Cash Back Card', 'demo-riverstone', 0)

  for (let offset = -HISTORY_DAYS; offset <= 0; offset++) {
    const day = dayAt(now, offset)
    const rng = random(`starter:${day.key}`)
    if (day.weekday === 5 && Math.floor(day.date / 7) % 2 === 0) {
      checking.add(day, 'payroll', 'GLOBEX LLC DIRECT DEP', 2_046_38)
    }
    if (day.date === 1) checking.add(day, 'rent', 'CEDAR RIDGE APTS RENT', -1_475_00)
    if (day.date === 6) checking.add(day, 'phone', 'VERIZON WIRELESS', -65_00)
    if (day.date === 11) card.add(day, 'streaming', 'HULU 877-8244858', -17_99)
    if (day.date === 19) card.add(day, 'gym', 'PLANET FITNESS', -24_99)
    if (day.date === 25) {
      checking.add(day, 'cardpay', 'CASH BACK CARD PAYMENT', -600_00)
      card.add(day, 'payment', 'PAYMENT RECEIVED - THANK YOU', 600_00)
    }
    for (const [slug, description, p, min, max] of MERCHANTS) {
      if (rng() < p) card.add(day, slug, description, -cents(rng, min, max))
    }
  }

  return {
    errlist: [],
    connections: [{ conn_id: 'demo-riverstone', name: 'Riverstone Credit Union' }],
    accounts: [checking.render(now), card.render(now, { pendingAfter: dayAt(now, -1).key })]
  }
}

export const starter: DatasetDefinition = {
  id: 'starter',
  name: 'Fresh start',
  description: 'Two months of a newly connected bank, nothing categorized yet.',
  accountSet,
  settings: { onboardingComplete: true }
}
