import { useState } from 'react'
import type { EnvelopeSummary } from '@shared/budgets'
import { Amount } from '@/components/amount'
import { useSetFill } from '@/components/budget/use-envelopes'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/number-input'
import { currencySymbol, parseDollars } from '@/lib/utils'

// The card and the table are two views of the same envelope, so they edit it
// through the same field.

/**
 * Click-to-edit fill amount: an edit made while viewing month M re-anchors the
 * fill from M forward and leaves earlier months' history untouched.
 */
export function EditableFill({
  envelope,
  month,
  currency
}: {
  envelope: EnvelopeSummary
  month: string
  currency: string
}) {
  const setFill = useSetFill()
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 font-normal tabular-nums"
        onClick={() => setDraft((envelope.fill / 1000).toString())}
      >
        <Amount value={envelope.fill} currency={currency} colored={false} />
      </Button>
    )
  }

  const commit = (): void => {
    const amount = parseDollars(draft)
    if (amount !== null && amount !== envelope.fill)
      setFill.mutate({ categoryId: envelope.categoryId, month, amount })
    setDraft(null)
  }

  return (
    <NumberInput
      autoFocus
      prefix={currencySymbol(currency)}
      min={0}
      value={draft}
      onValueChange={setDraft}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      className="w-28"
    />
  )
}
