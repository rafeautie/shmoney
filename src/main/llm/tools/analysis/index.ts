// The typed tools by name: the worker registers every entry the same way, so
// adding a tool is a schema in schemas.ts plus a runner here.
import type { AnalysisToolName } from '@shared/chat'
import type { AnalysisContext, ToolOutput } from './common'
import { runTotals } from './totals'
import { runGoals } from './goals'
import { runTransactions } from './transactions'
import { runBudgets } from './budgets'
import { runRecurring } from './recurring'
import { runBalances } from './balances'
import { runWhatIf } from './what-if'
import { runUnusual } from './unusual'

export type AnalysisRunner = (args: Record<string, unknown>, ctx: AnalysisContext) => ToolOutput

export const ANALYSIS_RUNNERS: Record<AnalysisToolName, AnalysisRunner> = {
  totals: runTotals,
  goals: runGoals,
  transactions: runTransactions,
  budgets: runBudgets,
  recurring: runRecurring,
  balances: runBalances,
  what_if: runWhatIf,
  unusual: runUnusual
}

export { runAction, type ProposalOutput } from './actions'
export { analysisToolSchemas, actionToolSchemas, type ToolVocab } from './schemas'
export {
  modelView,
  replayView,
  type AnalysisContext,
  type GoalPaceInput,
  type ToolOutput
} from './common'
