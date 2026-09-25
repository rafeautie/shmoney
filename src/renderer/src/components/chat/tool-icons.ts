import type { IconSvgElement } from '@hugeicons/react'
import {
  Alert02Icon,
  Analytics01Icon,
  Calculator01Icon,
  Calendar03Icon,
  Coins01Icon,
  DatabaseIcon,
  Idea01Icon,
  PiggyBankIcon,
  ReceiptDollarIcon,
  RepeatIcon,
  Tag01Icon,
  Target02Icon,
  Wallet01Icon
} from '@hugeicons/core-free-icons'

/** each chat tool's icon, the one place a tool name maps to chrome (rail steps and approval cards) */
export const TOOL_ICONS: Record<string, IconSvgElement> = {
  query: DatabaseIcon,
  chart: Analytics01Icon,
  calc: Calculator01Icon,
  resolve_dates: Calendar03Icon,
  totals: Coins01Icon,
  goals: Target02Icon,
  transactions: ReceiptDollarIcon,
  budgets: PiggyBankIcon,
  recurring: RepeatIcon,
  balances: Wallet01Icon,
  what_if: Idea01Icon,
  unusual: Alert02Icon,
  recategorize: Tag01Icon,
  set_budget: PiggyBankIcon,
  update_goal: Target02Icon
}
