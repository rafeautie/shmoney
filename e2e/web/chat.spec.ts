import type { Locator, Page } from '@playwright/test'
import type { ChatMessagePart } from '@shared/chat'
import type { ScriptedReply } from '../../src/demo/e2e/llm-manager'
import { expect, test, type App } from '../fixtures'

const text = (value: string): ChatMessagePart => ({ type: 'text', text: value })

// every scripted part takes a beat so the in-progress states stay observable;
// the instant case has its own test
const queueReplies = (app: App, ...replies: ScriptedReply[]): Promise<void> =>
  app.bridge(
    (b, queued: ScriptedReply[]) => b.llm.reply(...queued),
    replies.map((reply) => ({ delayMs: 60, ...reply }))
  )

const composer = (page: Page): Locator => page.getByRole('textbox')

async function openReadyChat(app: App, route = '/chat'): Promise<void> {
  await app.open({ route })
  await app.bridge((b) => b.llm.ready())
  await expect(composer(app.page)).toBeVisible()
}

async function send(page: Page, message: string): Promise<void> {
  await composer(page).fill(message)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('seeded conversations are listed and render with their thought chain and chart', async ({
  app
}) => {
  const { page } = app
  await app.open({ route: '/chat' })
  for (const title of [
    'Am I on track with my savings goals?',
    'Chart my income versus spending by month',
    'What were my top spending categories last month?'
  ]) {
    await expect(page.getByRole('link', { name: title })).toBeVisible()
  }

  await page.getByRole('link', { name: 'What were my top spending categories last month?' }).click()
  await expect(page).toHaveURL(/#\/chat\?c=1$/)
  await expect(page.getByRole('button', { name: /Thought for \d+s · 2 calls/ })).toBeVisible()
  await expect(page.getByText('Spending by category')).toBeVisible()
  await expect(page.getByRole('application')).toBeVisible()
  await expect(page.getByText(/You spent \$[\d,.]+ last month/)).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Housing: $' })).toBeVisible()

  // without a model the transcript stays readable but the composer gives way
  await expect(page.getByText("The model isn't on this device", { exact: false })).toBeVisible()
  await expect(composer(page)).toBeHidden()
})

test('a new chat without the model shows the download gate until it is downloaded', async ({
  app
}) => {
  const { page } = app
  await app.open({ route: '/chat' })
  await expect(page.getByText('Download the model to chat')).toBeVisible()
  await expect(composer(page)).toBeHidden()

  await page.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(composer(page)).toBeVisible()
  await expect(page.getByText('Download the model to chat')).toBeHidden()
  await expect(page.getByText('Ask about your money')).toBeVisible()
})

test('the composer appears once the model is ready and starters are offered', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/chat' })
  await expect(page.getByText('Download the model to chat')).toBeVisible()
  await app.bridge((b) => b.llm.ready())
  await expect(composer(page)).toBeVisible()
  await expect(page.getByPlaceholder('How can I help you?')).toBeVisible()

  await expect(page.getByText('Ask about your money')).toBeVisible()
  for (const starter of [
    'How much do I spend each month?',
    'Am I on budget this month?',
    'What subscriptions am I paying for?'
  ]) {
    await expect(page.getByRole('button', { name: starter })).toBeVisible()
  }
})

test('picking a starter sends it as the first message', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, { parts: [text('You spend about the same each month.')] })

  await page.getByRole('button', { name: 'How much do I spend each month?' }).click()
  await expect(page).toHaveURL(/#\/chat\?c=4$/)
  await expect(page.getByText('You spend about the same each month.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'How much do I spend each month?' })).toBeVisible()
})

test('sending streams the scripted reply, settles it, and titles the conversation', async ({
  app
}) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, {
    delayMs: 150,
    parts: [text('First you spent a lot. '), text('Then you spent less.')]
  })

  await send(page, 'Where did my money go?')
  await expect(page).toHaveURL(/#\/chat\?c=4$/)
  await expect(page.getByText('Where did my money go?', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('First you spent a lot.')).toBeVisible()
  await expect(page.getByText('Then you spent less.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden()
  await expect(composer(page)).toHaveValue('')
  await expect(page.getByPlaceholder('Write a message...')).toBeVisible()

  await expect(page.getByRole('link', { name: 'Where did my money go?' })).toBeVisible()
  const rows = await app.sql<{ title: string; status: string }>(
    `SELECT c.title, m.status FROM conversations c
     JOIN chat_messages m ON m.conversation_id = c.id AND m.role = 'assistant'
     WHERE c.id = 4`
  )
  expect(rows).toEqual([{ title: 'Where did my money go?', status: 'complete' }])
})

test('Enter sends and Shift+Enter inserts a newline', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, { parts: [text('Got it.')] })

  const box = composer(page)
  await box.fill('line one')
  await box.press('Shift+Enter')
  await box.pressSequentially('line two')
  await expect(box).toHaveValue('line one\nline two')
  await expect(page.getByRole('link', { name: 'line one' })).toBeHidden()

  await box.press('Enter')
  await expect(page.getByText('Got it.')).toBeVisible()
  await expect(box).toHaveValue('')
  const [{ n }] = await app.sql<{ n: number }>(
    "SELECT count(*) AS n FROM chat_messages WHERE role = 'user' AND conversation_id = 4"
  )
  expect(n).toBe(1)
})

test('Send stays disabled for a blank message', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await composer(page).fill('   ')
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await composer(page).fill('hello')
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
})

test('Stop ends a held turn and marks it stopped', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, {
    delayMs: 100,
    holdUntilStop: true,
    parts: [text('Let me think about that')]
  })

  await send(page, 'Summarize everything')
  await expect(page.getByText('Let me think about that')).toBeVisible()
  const stop = page.getByRole('button', { name: 'Stop' })
  await expect(stop).toBeVisible()
  await expect(page.getByText('Stopped generating')).toBeHidden()

  await stop.click()
  await expect(page.getByText('Stopped generating')).toBeVisible()
  await expect(stop).toBeHidden()
  await expect(page.getByText('Let me think about that')).toBeVisible()
  const [{ status }] = await app.sql<{ status: string }>(
    "SELECT status FROM chat_messages WHERE role = 'assistant' AND conversation_id = 4"
  )
  expect(status).toBe('interrupted')
})

test('a failed turn keeps what streamed and shows the error bubble', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, {
    parts: [text('Looking into it')],
    error: 'The model ran out of memory'
  })

  await send(page, 'Anything at all')
  await expect(page.getByText('The model ran out of memory')).toBeVisible()
  await expect(page.getByText('Looking into it')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden()
  const [{ status }] = await app.sql<{ status: string }>(
    "SELECT status FROM chat_messages WHERE role = 'assistant' AND conversation_id = 4"
  )
  expect(status).toBe('error')
})

test('a reasoning step and tool call collapse into a thought chain above the answer', async ({
  app
}) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, {
    parts: [
      { type: 'reasoning', text: 'Add the two numbers.', durationMs: 2000 },
      {
        type: 'functionCall',
        name: 'calc',
        args: { expression: '2 + 2' },
        result: { ok: true, value: 4 },
        durationMs: 500
      },
      text('The answer is four.')
    ]
  })

  await send(page, 'What is 2 + 2?')
  await expect(page.getByText('The answer is four.')).toBeVisible()
  const chain = page.getByRole('button', { name: /Thought for \d+s · 1 call/ })
  await expect(chain).toBeVisible()
  await expect(page.getByText('Add the two numbers.')).toBeHidden()
  await chain.click()
  await expect(page.getByText('Add the two numbers.')).toBeVisible()
})

test('amounts in an answer render formatted and are masked by Hide amounts', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, { parts: [text('Rent was {{1234.56 USD}} this month.')] })

  await send(page, 'What was my rent?')
  const amount = page.locator('[data-private]').filter({ hasText: '$1,234.56' })
  await expect(amount).toBeVisible()
  await expect(amount).not.toHaveClass(/private-hidden/)

  await page.getByRole('button', { name: 'Hide amounts' }).click()
  await expect(amount).toHaveClass(/private-hidden/)
  await expect(page.getByRole('button', { name: 'Show amounts' })).toBeVisible()
})

test('a markdown table renders with copy and CSV download', async ({ app, context }) => {
  const { page } = app
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openReadyChat(app)
  const table = ['| Category | Total |', '| --- | --- |', '| Food | 120 |', '| Rent | 900 |']
  await queueReplies(app, { parts: [text(['Here you go:', '', ...table].join('\n'))] })

  await send(page, 'Give me a table')
  await expect(page.getByRole('columnheader', { name: 'Category' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Rent' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '900' })).toBeVisible()

  await page.getByRole('button', { name: 'Copy table' }).click()
  const copied = (): Promise<string[][]> =>
    page
      .evaluate(() => navigator.clipboard.readText())
      .then((value) => value.split('\n').map((row) => row.split('\t').map((cell) => cell.trim())))
  await expect.poll(copied).toEqual([
    ['Category', 'Total'],
    ['Food', '120'],
    ['Rent', '900']
  ])

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download table as CSV' }).click()
  expect((await download).suggestedFilename()).toBe('table.csv')
})

async function budgetProposalReply(
  app: App,
  categoryName: string,
  after: number
): Promise<{ category: { id: number; name: string }; part: ChatMessagePart }> {
  const [category] = await app.sql<{ id: number; name: string }>(
    `SELECT id, name FROM categories WHERE name LIKE '%${categoryName}'`
  )
  const display = {
    proposal: {
      kind: 'set_budget',
      categoryId: category.id,
      category: category.name,
      month: '2026-09',
      before: null,
      after,
      averageSpending: null,
      currency: 'USD'
    },
    status: 'approval-requested',
    actionId: null,
    applied: null,
    skipped: null
  }
  const part = {
    type: 'functionCall',
    name: 'set_budget',
    args: { category: category.name, amount: after },
    result: { ok: true, summary: 'Proposed' },
    display,
    durationMs: 400
  } as ChatMessagePart
  return { category, part }
}

test('a budget proposal can be applied, and undone from the toast', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  const { category, part } = await budgetProposalReply(app, 'Groceries', 777)
  await queueReplies(app, { parts: [part, text('I can set that budget for you.')] })

  await send(page, 'Set my groceries budget to 777')
  await expect(
    page.locator('[data-slot=item-title]').filter({ hasText: /Set .*Groceries budget to/ })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  await page.getByRole('button', { name: 'Apply' }).click()

  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: /Set the .*Groceries budget/ })
  await expect(toast).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply' })).toBeHidden()
  const stored = (): Promise<{ amount: number }[]> =>
    app.sql<{ amount: number }>(
      `SELECT amount FROM budgets WHERE category_id = ${category.id} AND month = '2026-09'`
    )
  await expect.poll(stored).toEqual([{ amount: 777_000 }])

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Undone', { exact: true })).toBeVisible()
  await expect.poll(stored).toEqual([])
})

test('a budget proposal can be dismissed without changing anything', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  const { category, part } = await budgetProposalReply(app, 'Dining Out', 321)
  await queueReplies(app, { parts: [part] })

  await send(page, 'Budget dining at 321')
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText('Dismissed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply' })).toBeHidden()
  expect(
    await app.sql(
      `SELECT amount FROM budgets WHERE category_id = ${category.id} AND amount = 321000`
    )
  ).toEqual([])
})

test('a conversation is renamed inline: Enter commits, Escape cancels', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/chat' })
  const original = 'Chart my income versus spending by month'

  const openRename = async (name: string): Promise<void> => {
    await page.getByRole('link', { name }).hover()
    await page.getByRole('button', { name: 'Conversation actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
  }

  await openRename(original)
  const input = page.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill('Cancelled title')
  await input.press('Escape')
  await expect(page.getByRole('link', { name: original })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cancelled title' })).toBeHidden()

  await openRename(original)
  await page.getByRole('textbox').fill('Income vs spending')
  await page.getByRole('textbox').press('Enter')
  await expect(page.getByRole('link', { name: 'Income vs spending' })).toBeVisible()
  await expect(page.getByRole('link', { name: original })).toBeHidden()
  const rows = await app.sql<{ title: string }>('SELECT title FROM conversations WHERE id = 2')
  expect(rows).toEqual([{ title: 'Income vs spending' }])
})

test('deleting a conversation removes it at once and Undo brings it back', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/chat' })
  const title = 'Am I on track with my savings goals?'

  await page.getByRole('link', { name: title }).hover()
  await page.getByRole('button', { name: 'Conversation actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  await expect(page.getByRole('link', { name: title })).toBeHidden()
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Conversation deleted' })
  await expect(toast).toBeVisible()
  await expect
    .poll(() => app.sql('SELECT id FROM conversations WHERE deleted_at IS NULL AND id = 3'))
    .toEqual([])

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('link', { name: title })).toBeVisible()
})

test('deleting the open conversation returns to a new chat', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/chat?c=2' })
  await expect(page.getByText('Income vs. spending by month')).toBeVisible()

  const title = 'Chart my income versus spending by month'
  await page.getByRole('link', { name: title }).hover()
  await page.getByRole('button', { name: 'Conversation actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  await expect(page).toHaveURL(/#\/chat$/)
  await expect(page.getByRole('link', { name: title })).toBeHidden()
  await expect(page.getByText('Download the model to chat')).toBeVisible()
})

test('the scope select narrows a new chat to one account', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await queueReplies(app, { parts: [text('Checking looks fine.')] })

  const [account] = await app.sql<{ id: number; name: string }>(
    'SELECT id, name FROM accounts ORDER BY id LIMIT 1'
  )
  await page.getByRole('button', { name: 'All accounts' }).click()
  await page.getByRole('option', { name: account.name }).click()
  await expect(page.getByRole('button', { name: account.name })).toBeVisible()

  await send(page, 'How is this account?')
  await expect(page.getByText('Checking looks fine.')).toBeVisible()
  await expect(page.getByText(`Narrowed to ${account.name}`)).toBeVisible()
  const [row] = await app.sql<{ account_id: number | null }>(
    "SELECT account_id FROM conversations WHERE title = 'How is this account?'"
  )
  expect(row.account_id).toBe(account.id)
})

test('a reply that dropped older history warns that older messages are not sent', async ({
  app
}) => {
  const { page } = app
  await openReadyChat(app, '/chat?c=1')
  await queueReplies(app, { historyDropped: 1, parts: [text('Short answer.')] })

  await expect(page.getByText("Older messages aren't sent to the model")).toBeHidden()
  await send(page, 'And what about this month?')
  await expect(page.getByText('Short answer.')).toBeVisible()
  await expect(page.getByText("Older messages aren't sent to the model")).toBeVisible()
})

test('the web demo explains that chat runs on the desktop and keeps seeded chats readable', async ({
  app
}) => {
  const { page } = app
  await app.open({ route: '/chat', desktop: false })
  await expect(page.getByText('Chat runs on your computer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Get shmoney' })).toBeVisible()

  await page.getByRole('link', { name: 'Chart my income versus spending by month' }).click()
  await expect(page.getByText('Income vs. spending by month')).toBeVisible()
  await expect(page.getByText('conversations here are read-only', { exact: false })).toBeVisible()
  await expect(composer(page)).toBeHidden()
})

test('a reply that settles before the send call resolves still finishes', async ({ app }) => {
  const { page } = app
  await openReadyChat(app)
  await app.bridge((b) => b.llm.reply({ parts: [{ type: 'text', text: 'Instant answer' }] }))

  await send(page, 'Quick one')
  await expect(page.getByText('Instant answer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden()
  await expect(composer(page)).toBeEnabled()
})
