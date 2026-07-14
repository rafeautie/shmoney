import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, format, startOfDay } from 'date-fns'
import type { Rule, RuleAction, RuleConditions } from '@shared/rules'
import { cn, ipcErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PhraseInput } from './phrase-input'

// ---- dollar <-> milliunit helpers ----
const toMilli = (dollars: string): number => Math.round(parseFloat(dollars) * 1000)
const toDollars = (milli: number): string => String(milli / 1000)

// a pre-filled starting point for a new rule (e.g. from a rule suggestion)
export interface RuleDraft {
  name: string
  conditions: RuleConditions
  action: RuleAction
}

type DescOp = 'contains' | 'equals'
type AmtOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between'
type Direction = 'any' | 'in' | 'out'

const AMT_OP_LABELS: Record<AmtOp, string> = {
  eq: 'is exactly',
  gt: 'is more than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
  between: 'is between'
}

export function RuleEditor({
  rule,
  draft,
  draftKey,
  open,
  onOpenChange,
  onSaved
}: {
  rule: Rule | null
  /** pre-fills a NEW rule's fields (rule takes precedence when editing) */
  draft?: RuleDraft | null
  /** distinguishes one draft from the next so the form remounts and reseeds */
  draftKey?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (rule: Rule, wasCreate: boolean) => void
}): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {/* key resets all draft state when switching between rules / drafts / new */}
        {open && (
          <RuleForm
            key={rule?.id ?? draftKey ?? 'new'}
            rule={rule}
            draft={draft ?? null}
            onSaved={onSaved}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function RuleForm({
  rule,
  draft,
  onSaved,
  onDone
}: {
  rule: Rule | null
  draft: RuleDraft | null
  onSaved?: (rule: Rule, wasCreate: boolean) => void
  onDone: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })

  const src = rule ?? draft
  const c = src?.conditions
  const [name, setName] = useState(src?.name ?? '')

  const [descOp, setDescOp] = useState<DescOp>(c?.description?.op ?? 'contains')
  const [phrases, setPhrases] = useState<string[]>(c?.description?.phrases ?? [])

  const [amtOp, setAmtOp] = useState<AmtOp>(c?.amount?.op ?? 'gt')
  const [amtValue, setAmtValue] = useState(c?.amount ? toDollars(c.amount.value) : '')
  const [amtValue2, setAmtValue2] = useState(
    c?.amount?.value2 !== undefined ? toDollars(c.amount.value2) : ''
  )
  const [direction, setDirection] = useState<Direction>(c?.amount?.direction ?? 'any')

  const [accountId, setAccountId] = useState<number | null>(c?.accountId ?? null)

  const [dateAfter, setDateAfter] = useState<Date | undefined>(
    c?.date?.after !== undefined ? new Date(c.date.after * 1000) : undefined
  )
  const [dateBefore, setDateBefore] = useState<Date | undefined>(
    c?.date?.before !== undefined ? new Date(c.date.before * 1000) : undefined
  )
  const [domMin, setDomMin] = useState(
    c?.date?.dayOfMonthMin !== undefined ? String(c.date.dayOfMonthMin) : ''
  )
  const [domMax, setDomMax] = useState(
    c?.date?.dayOfMonthMax !== undefined ? String(c.date.dayOfMonthMax) : ''
  )

  const [categoryId, setCategoryId] = useState<number | null>(src?.action.categoryId ?? null)

  function buildConditions(): RuleConditions {
    const conditions: RuleConditions = {}
    if (phrases.length > 0) conditions.description = { op: descOp, phrases }
    if (amtValue.trim()) {
      conditions.amount = {
        op: amtOp,
        value: toMilli(amtValue),
        ...(amtOp === 'between' && amtValue2.trim() ? { value2: toMilli(amtValue2) } : {}),
        ...(direction !== 'any' ? { direction } : {})
      }
    }
    if (accountId !== null) conditions.accountId = accountId
    const date: NonNullable<RuleConditions['date']> = {}
    if (dateAfter) date.after = Math.floor(startOfDay(dateAfter).getTime() / 1000)
    if (dateBefore) date.before = Math.floor(endOfDay(dateBefore).getTime() / 1000)
    if (domMin.trim()) date.dayOfMonthMin = Number(domMin)
    if (domMax.trim()) date.dayOfMonthMax = Number(domMax)
    if (Object.keys(date).length > 0) conditions.date = date
    return conditions
  }

  const hasCondition =
    phrases.length > 0 ||
    amtValue.trim() !== '' ||
    accountId !== null ||
    dateAfter !== undefined ||
    dateBefore !== undefined ||
    domMin.trim() !== '' ||
    domMax.trim() !== ''
  const canSave = name.trim() !== '' && hasCondition && categoryId !== null

  const save = useMutation({
    mutationFn: () => {
      const action: RuleAction = { type: 'setCategory', categoryId: categoryId! }
      const conditions = buildConditions()
      return rule
        ? window.api.rules.update({ id: rule.id, name: name.trim(), conditions, action })
        : window.api.rules.create({ name: name.trim(), conditions, action })
    },
    onSuccess: (saved) => {
      onSaved?.(saved, !rule)
      onDone()
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  const categories = categoriesQuery.data
  const accounts = accountsQuery.data ?? []

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) save.mutate()
      }}
    >
      <SheetHeader>
        <SheetTitle>{rule ? 'Edit rule' : 'New rule'}</SheetTitle>
        <SheetDescription>
          A rule applies its action to transactions matching every condition you set.
        </SheetDescription>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 px-6 pb-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Coffee shops"
            />
          </div>

          <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">When a transaction matches all of…</legend>

            {/* Description */}
            <div className="flex flex-col gap-2">
              <Label className="font-medium">Description</Label>
              <div className="flex flex-col gap-2">
                <Select value={descOp} onValueChange={(v) => setDescOp(v as DescOp)}>
                  <SelectTrigger className="w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="equals">equals</SelectItem>
                  </SelectContent>
                </Select>
                <PhraseInput value={phrases} onChange={setPhrases} placeholder="add a phrase" />
                <p className="text-xs text-muted-foreground">
                  Matches if the description {descOp === 'equals' ? 'is' : 'contains'} any phrase;
                  leave empty to ignore.
                </p>
              </div>
            </div>

            <Separator className="-mx-4 data-horizontal:w-auto" />

            {/* Amount */}
            <div className="flex flex-col gap-2">
              <Label className="font-medium">Amount</Label>
              <div className="flex flex-wrap gap-2">
                <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
                  <SelectTrigger className="w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any direction</SelectItem>
                    <SelectItem value="in">Money in</SelectItem>
                    <SelectItem value="out">Money out</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={amtOp} onValueChange={(v) => setAmtOp(v as AmtOp)}>
                  <SelectTrigger className="w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AMT_OP_LABELS) as AmtOp[]).map((op) => (
                      <SelectItem key={op} value={op}>
                        {AMT_OP_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amtValue}
                  onChange={(event) => setAmtValue(event.target.value)}
                  placeholder="amount"
                  className="w-28"
                />
                {amtOp === 'between' && (
                  <>
                    <span className="self-center text-sm text-muted-foreground">and</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={amtValue2}
                      onChange={(event) => setAmtValue2(event.target.value)}
                      placeholder="amount"
                      className="w-28"
                    />
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Compares the dollar amount regardless of sign; use direction to match only money in
                or out.
              </p>
            </div>

            <Separator className="-mx-4 data-horizontal:w-auto" />

            {/* Account */}
            <div className="flex flex-col gap-2">
              <Label className="font-medium">Account</Label>
              <Select
                value={accountId === null ? 'any' : String(accountId)}
                onValueChange={(v) => setAccountId(v === 'any' ? null : Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any account</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.institutionName
                        ? `${account.institutionName} · ${account.name}`
                        : account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator className="-mx-4 data-horizontal:w-auto" />

            {/* Date */}
            <div className="flex flex-col gap-2">
              <Label className="font-medium">Date</Label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">on/after</span>
                <DateField value={dateAfter} onChange={setDateAfter} />
                <span className="text-sm text-muted-foreground">on/before</span>
                <DateField value={dateBefore} onChange={setDateBefore} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">day of month</span>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={domMin}
                  onChange={(event) => setDomMin(event.target.value)}
                  placeholder="1"
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={domMax}
                  onChange={(event) => setDomMax(event.target.value)}
                  placeholder="31"
                  className="w-20"
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">…do this</legend>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Set category to</span>
              <Select
                value={categoryId === null ? '' : String(categoryId)}
                onValueChange={(v) => setCategoryId(Number(v))}
              >
                <SelectTrigger className="min-w-40 flex-1">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.groups.map((group) => (
                    <SelectGroup key={group.id}>
                      <SelectLabel>{group.name}</SelectLabel>
                      {group.categories.map((category) => (
                        <SelectItem key={category.id} value={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                  {categories?.ungrouped.map((category) => (
                    <SelectItem key={category.id} value={String(category.id)}>
                      {category.name}
                    </SelectItem>
                  ))}
                  {categories && categories.system.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>System</SelectLabel>
                      {categories.system.map((category) => (
                        <SelectItem key={category.id} value={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Rules only fill blanks; they never overwrite a category you set yourself.
            </p>
          </fieldset>

          {save.isError && (
            <p className="text-sm text-destructive">{ipcErrorMessage(save.error)}</p>
          )}
        </div>
      </ScrollArea>

      <SheetFooter className="flex-row justify-end gap-2 border-t">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || save.isPending}>
          {save.isPending ? 'Saving…' : rule ? 'Save rule' : 'Create rule'}
        </Button>
      </SheetFooter>
    </form>
  )
}

// a single-date picker: calendar popover with a formatted-date button trigger.
// Selecting the same day again clears the bound (react-day-picker deselects).
function DateField({
  value,
  onChange
}: {
  value: Date | undefined
  onChange: (date: Date | undefined) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('w-40 justify-start font-normal', !value && 'text-muted-foreground')}
        >
          {value ? format(value, 'MMM d, yyyy') : 'Any date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          showOutsideDays={false}
          selected={value}
          defaultMonth={value}
          onSelect={(date) => {
            onChange(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
