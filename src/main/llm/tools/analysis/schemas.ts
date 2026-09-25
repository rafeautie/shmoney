// The typed chat tools' descriptions and parameter schemas, built per turn so
// every name the model can write is a real one: node-llama-cpp compiles these
// schemas into the grammar that constrains the call, so an enum here is a value
// the model cannot misspell. Every property is required by that grammar, so
// lists stay short, open with the parameters that decide the answer, and use
// null for "not narrowed". Kept free of path aliases so scripts can import it.

export interface ToolVocab {
  /** category names the model may filter on (system categories left out) */
  categories: string[]
  accounts: string[]
  /** active savings goal names */
  goals: string[]
}

export const PERIOD_FORMS =
  "this_month, last_month, last_3_months, last_6_months, last_12_months, this_year, last_year, all, or one month '2026-07', quarter '2026-Q2' or year '2025'"

const period = (what: string): object => ({
  type: 'string',
  description: `${what}: ${PERIOD_FORMS}. last_N_months means N complete months; this_month is the month so far.`
})

/** A nullable enum, or plain null when there is nothing to pick from. */
function nullableEnum(values: string[], description: string): object {
  return values.length > 0
    ? { oneOf: [{ type: 'null' }, { enum: values }], description }
    : { type: 'null', description }
}

function requiredEnum(values: string[], description: string): object {
  return values.length > 0 ? { enum: values, description } : { type: 'null', description }
}

const nullableString = (description: string): object => ({
  type: ['string', 'null'],
  description
})

const nullableNumber = (description: string): object => ({
  type: ['number', 'null'],
  description
})

// an enum with 'auto' first rather than a boolean: asked for a boolean, the
// model answered false even for a monthly trend; the tool knows its own shape
const chartFlag = (what: string): object => ({
  enum: ['auto', 'none'],
  description: `auto draws ${what} as a chart when there are enough rows to be worth seeing; none when the user asked for no chart.`
})

export interface ToolSchema {
  description: string
  params: { type: 'object'; properties: Record<string, object> }
}

export type AnalysisToolName =
  'totals' | 'goals' | 'transactions' | 'budgets' | 'recurring' | 'balances' | 'what_if' | 'unusual'

export type ActionToolName = 'recategorize' | 'set_budget' | 'update_goal'

export function analysisToolSchemas(v: ToolVocab): Record<AnalysisToolName, ToolSchema> {
  const category = nullableEnum(v.categories, 'Only this category, or null for all.')
  const account = nullableEnum(v.accounts, 'Only this account, or null for all.')
  const search = nullableString(
    "Text to match in the merchant or description, e.g. 'coffee' or 'amazon'; null for no text filter. The result lists what it matched."
  )
  return {
    totals: {
      description:
        "How much was spent, earned or netted: one total, a trend over time, a breakdown by category, merchant or account, or a comparison with another period. Use it for 'how much', 'each month', 'where does my money go', 'more than last month', 'why was July higher', 'how much did I save'. The result's facts hold the finished figures: totals, averages over complete months, highest and lowest, changes and what drove them.",
      params: {
        type: 'object',
        properties: {
          measure: {
            enum: ['spending', 'income', 'net'],
            description: 'net is income minus spending, what was saved overall.'
          },
          by: {
            enum: [
              'none',
              'month',
              'quarter',
              'year',
              'week',
              'weekday',
              'category',
              'category_group',
              'merchant',
              'account'
            ],
            description: 'One row per this; none for a single total.'
          },
          split: {
            enum: ['none', 'category', 'category_group', 'merchant', 'account'],
            description:
              'none, unless the question asks for a second breakdown inside each row, e.g. each month split by category.'
          },
          period: period('The period to total'),
          compare_to: nullableString(
            "null unless the question compares two periods. Then the other period, in the same forms, or 'previous' for the period just before, or 'last_year' for the same period a year earlier."
          ),
          category,
          account,
          search,
          chart: chartFlag('the rows')
        }
      }
    },
    goals: {
      description:
        "The user's savings goals: progress, status, what is needed per month and projected dates (view status), or how a goal has grown month by month (view history). Use it when a goal is named or the question is about saving toward something; a 'what if I cut or stopped something' question goes to what_if instead.",
      params: {
        type: 'object',
        properties: {
          goal: nullableEnum(v.goals, 'One goal, or null for every goal.'),
          view: { enum: ['status', 'history'] },
          chart: chartFlag('the history')
        }
      }
    },
    transactions: {
      description:
        "Individual transactions: the biggest purchases, the latest ones, or the charges from one merchant or category. Use it when the question is about specific purchases rather than totals, e.g. 'my biggest purchase', 'show my Amazon orders'.",
      params: {
        type: 'object',
        properties: {
          sort: { enum: ['largest', 'newest'] },
          direction: {
            enum: ['spending', 'income', 'all'],
            description: 'spending for purchases and charges, income for money coming in.'
          },
          period: period('Which transactions'),
          category,
          account,
          search,
          limit: { type: 'integer', description: 'How many to list, 1 to 25.' }
        }
      }
    },
    budgets: {
      description:
        "Budget status for one month: per category the budget, what was spent, what is available, and whether it is on pace, plus the month's totals and savings toward goals. Use it for 'am I on budget', 'what is left for dining', 'am I overspending'.",
      params: {
        type: 'object',
        properties: {
          month: nullableString("A month 'YYYY-MM', or null for the current month."),
          chart: chartFlag('budget against spending')
        }
      }
    },
    recurring: {
      description:
        "Recurring charges found in the transactions: subscriptions and bills, with how often they charge, the typical amount, the next expected date and any price change. Use it for subscriptions, bills, 'what do I pay every month', price increases.",
      params: {
        type: 'object',
        properties: {
          kind: { enum: ['all', 'subscriptions', 'bills'] },
          chart: chartFlag('the charges')
        }
      }
    },
    balances: {
      description:
        "Current balances: every account, whether it is an asset or a debt, its change over the last 30 days, and the goals it funds, plus net worth, assets and debts. Use it for 'how much do I have', 'net worth', 'what is in savings'.",
      params: {
        type: 'object',
        properties: {
          account: nullableEnum(v.accounts, 'One account, or null for all.'),
          chart: chartFlag('the balances')
        }
      }
    },
    what_if: {
      description:
        "Scenario math on the user's real averages: what cutting or raising spending on something would save per month and per year, and optionally how it moves a savings goal's projected date. Use it for 'what if I cut dining in half', 'if I cancel Netflix', and for 'when would I reach my goal if I cut or stopped something'.",
      params: {
        type: 'object',
        properties: {
          category: nullableEnum(v.categories, 'The category to change, or null.'),
          search: nullableString(
            "A merchant to change instead, e.g. 'netflix'; null when changing a category or all spending."
          ),
          change_percent: nullableNumber(
            'The change as a percent of the current spending: -50 halves it, -100 stops it. null when change_per_month is given.'
          ),
          change_per_month: nullableNumber(
            'The change as an amount per month: -200 spends 200 less. null when change_percent is given.'
          ),
          goal: nullableEnum(v.goals, 'A goal the saving would go toward, or null.')
        }
      }
    },
    unusual: {
      description:
        "Things worth a look in a period: possible duplicate charges, new merchants, price changes, categories running above their usual pace, unusually large charges, and goals falling behind. Use it for 'anything unusual', 'anything odd this month', 'what should I know'.",
      params: {
        type: 'object',
        properties: {
          period: period('The period to check')
        }
      }
    }
  }
}

export function actionToolSchemas(v: ToolVocab): Record<ActionToolName, ToolSchema> {
  const review =
    "The user reviews the change and applies it themselves; nothing changes until they do. Call it only when the user tells you to make this change. A question such as 'should I move…' or 'what if I…' is not a request: answer it with the other tools, and let the user ask for the change."
  // written before the enum: the grammar forces the enum to a real name, so
  // without the user's own words a missing category became the nearest one
  const asAsked = {
    type: 'string',
    description:
      "The category exactly as the user named it, e.g. 'eating out' or 'pet supplies'; never a merchant or store name."
  }
  return {
    recategorize: {
      description: `Propose moving matching transactions to another category. ${review}`,
      params: {
        type: 'object',
        properties: {
          as_asked: asAsked,
          to_category: requiredEnum(v.categories, 'The category to move them to.'),
          search: nullableString(
            "Text to match in the merchant or description, e.g. 'amazon'; null for no text filter."
          ),
          from_category: nullableEnum(
            ['Uncategorized', ...v.categories],
            'Only transactions now in this category, or null for any.'
          ),
          period: period('Which transactions'),
          account: nullableEnum(v.accounts, 'Only this account, or null for all.')
        }
      }
    },
    set_budget: {
      description: `Propose a monthly budget amount for a category. ${review}`,
      params: {
        type: 'object',
        properties: {
          as_asked: asAsked,
          category: requiredEnum(v.categories, 'The category to budget.'),
          amount: { type: 'number', description: 'The monthly budget amount.' },
          from_month: nullableString(
            "The first month it applies to, 'YYYY-MM'; null for the current month. Later months keep it until changed."
          )
        }
      }
    },
    update_goal: {
      description: `Propose changing a savings goal's target amount or target date, or archiving it once it is done. ${review}`,
      params: {
        type: 'object',
        properties: {
          goal: requiredEnum(v.goals, 'The goal to change.'),
          target_amount: nullableNumber('The new target amount, or null to keep it.'),
          target_date: {
            oneOf: [{ type: 'null' }, { type: 'string', format: 'date' }],
            description: "The new target date 'YYYY-MM-DD', or null to keep it."
          },
          archived: {
            type: ['boolean', 'null'],
            description: 'true to archive a finished goal, null to leave it.'
          }
        }
      }
    }
  }
}
