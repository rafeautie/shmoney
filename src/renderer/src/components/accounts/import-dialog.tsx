import { memo, useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  CSV_DATE_FORMATS,
  type CsvMapping,
  type ImportPreview,
  type PickFileResult
} from '@shared/import'
import { HugeiconsIcon } from '@hugeicons/react'
import { FileImportIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { data as currencyData } from 'currency-codes'
import { invalidateTransactionData } from '@/lib/invalidate'
import { cn, currencySymbol, ipcErrorMessage, plural, TABLE_BLEED } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type PickedFile = Exclude<PickFileResult, null>
type Step = 'file' | 'account' | 'mapping' | 'preview'

type PreviewRow = ImportPreview['rows'][number] & { dateLabel: string }
interface PreviewData {
  rows: PreviewRow[]
  errors: ImportPreview['errors']
  /** rows checked by default (status 'new') */
  byId: Map<string, PreviewRow>
  newCount: number
  duplicateCount: number
}

// display strings and counts once per preview result, not per render
function toPreviewData(preview: ImportPreview): PreviewData {
  let newCount = 0
  let duplicateCount = 0
  const rows = preview.rows.map((row) => {
    if (row.status === 'new') newCount++
    else if (row.status === 'duplicate') duplicateCount++
    return { ...row, dateLabel: format(new Date(row.posted * 1000), 'MMM d, yyyy') }
  })
  const byId = new Map(rows.map((row) => [row.externalId, row]))
  return { rows, errors: preview.errors, byId, newCount, duplicateCount }
}

/** a row's checkbox when the user hasn't touched it: new rows in, probable duplicates opt-in */
const includedByDefault = (row: PreviewRow): boolean => row.status === 'new'

const NO_TOGGLES: ReadonlySet<string> = new Set()

export function ImportDialog({
  open,
  onOpenChange,
  initialFile
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A file that arrived from outside the dialog (opened from the OS through a
   * file association); skips the file-picking step. Must be referentially
   * stable while the dialog is open. */
  initialFile?: { fileName: string; bytes: Uint8Array }
}): React.JSX.Element {
  const queryClient = useQueryClient()

  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<PickedFile | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [accountId, setAccountId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newCurrency, setNewCurrency] = useState('USD')
  const [newBalance, setNewBalance] = useState('')
  /** externalIds the user flipped from their default, for the preview result they
   * were made on (a new result starts clean); duplicates are excluded regardless */
  const [toggles, setToggles] = useState<{
    data: PreviewData | undefined
    ids: ReadonlySet<string>
  }>({ data: undefined, ids: NO_TOGGLES })

  // a stale file/selection must never carry over into the next import
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- wholesale reset on reopen is the point; the extra render on a closed->open transition is harmless
    setStep('file')
    setFile(null)
    setMapping(null)
    setMode('existing')
    setAccountId(null)
    setNewName('')
    setNewCurrency('USD')
    setNewBalance('')
    setToggles({ data: undefined, ids: NO_TOGGLES })
  }, [open])

  // the parsed file lives in main under its handle; let it go (and the preview
  // built from it) once the dialog closes or another file replaces it
  const handle = file?.handle
  useEffect(() => {
    if (!open || !handle) return
    return () => {
      void window.api.import.release(handle)
      queryClient.removeQueries({ queryKey: ['import', 'preview', handle] })
    }
  }, [open, handle, queryClient])

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list(),
    enabled: open
  })
  const accounts = accountsQuery.data ?? []
  const accountLabel = (account: (typeof accounts)[number]) =>
    `${account.institutionName ? `${account.institutionName} · ` : ''}${account.name}`

  const { mutate: pickFile, ...pick } = useMutation({
    mutationFn: (dropped?: { fileName: string; bytes: Uint8Array }) =>
      window.api.import.pickFile(dropped ? { dropped } : undefined),
    meta: { silenceError: true },
    onSuccess: (result) => {
      if (!result) return // canceled the native dialog
      setFile(result)
      setMapping(result.kind === 'csv' ? result.suggestedMapping : null)
      setStep('account')
    }
  })

  // a file that arrived from outside the dialog goes straight through the same
  // path a drop on the empty state takes, landing the user on the account step
  useEffect(() => {
    if (!open || !initialFile) return
    pickFile(initialFile)
  }, [open, initialFile, pickFile])

  const [dragging, setDragging] = useState(false)
  const dropFile = async (dropped: File): Promise<void> => {
    const bytes = new Uint8Array(await dropped.arrayBuffer())
    pickFile({ fileName: dropped.name, bytes })
  }

  const csvMapping =
    file?.kind === 'csv' && mapping && mappingComplete(mapping) ? mapping : undefined
  const previewAccountId = mode === 'existing' && accountId !== null ? accountId : undefined
  const preview = useQuery({
    queryKey: ['import', 'preview', handle, csvMapping, previewAccountId],
    queryFn: () =>
      window.api.import.preview({
        handle: handle!,
        mapping: csvMapping,
        accountId: previewAccountId
      }),
    select: toPreviewData,
    meta: { silenceError: true },
    enabled: open && step === 'preview' && !!handle && (file?.kind !== 'csv' || !!csvMapping),
    // the file is fixed under its handle, so Back -> Next can reuse the result;
    // closing the dialog drops it
    staleTime: Infinity
  })

  const previewData = preview.data
  const toggled = toggles.data === previewData ? toggles.ids : NO_TOGGLES
  const isIncluded = (row: PreviewRow): boolean =>
    row.status !== 'duplicate' && includedByDefault(row) !== toggled.has(row.externalId)
  const onToggle = (row: PreviewRow, checked: boolean): void =>
    setToggles((prev) => {
      const ids = new Set(prev.data === previewData ? prev.ids : NO_TOGGLES)
      if (checked === includedByDefault(row)) ids.delete(row.externalId)
      else ids.add(row.externalId)
      return { data: previewData, ids }
    })
  // the default count adjusted by each flip, so a toggle doesn't rescan every row
  let selectedCount = previewData?.newCount ?? 0
  for (const id of toggled) {
    const row = previewData?.byId.get(id)
    if (row) selectedCount += includedByDefault(row) ? -1 : 1
  }

  const balanceInvalid = newBalance.trim() !== '' && !Number.isFinite(Number(newBalance))
  const accountStepReady =
    mode === 'existing'
      ? accountId !== null
      : newName.trim() !== '' && newCurrency.trim() !== '' && !balanceInvalid
  const currency =
    mode === 'existing'
      ? (accounts.find((a) => a.id === accountId)?.currency ?? 'USD')
      : newCurrency

  const apply = useMutation({
    meta: { silenceError: true },
    mutationFn: () => {
      const excluded = (previewData?.rows ?? [])
        .filter((row) => row.status !== 'duplicate' && !isIncluded(row))
        .map((row) => row.externalId)
      const target =
        mode === 'existing'
          ? { accountId: accountId! }
          : {
              newAccount: {
                name: newName.trim(),
                currency: newCurrency.trim(),
                balance:
                  newBalance.trim() === '' ? undefined : Math.round(Number(newBalance) * 1000)
              }
            }
      return window.api.import.apply({ handle: handle!, mapping: csvMapping, excluded, target })
    },
    onSuccess: (result) => {
      const extras = [
        result.skipped > 0 && `${result.skipped} skipped`,
        result.detectedTransfers > 0 && `${plural(result.detectedTransfers, 'transfer')} detected`,
        result.rulesApplied > 0 && `${result.rulesApplied} categorized by rules`
      ].filter(Boolean)
      toast(`Imported ${plural(result.inserted, 'transaction')}`, {
        description: extras.length > 0 ? extras.join(' · ') : undefined
      })
      onOpenChange(false)
    },
    // the rows, a new account, transfer and rule categorizations, the Activity entry
    onSettled: () => invalidateTransactionData(queryClient)
  })

  // dots cover only the post-file-picker steps (the ones with Back/Next); the
  // mapping step only exists for CSV files, so the count follows the file
  const steps: Step[] = [
    'account',
    ...(file?.kind === 'csv' ? (['mapping'] as const) : []),
    'preview'
  ]

  const next = (): void => {
    if (step === 'account') setStep(file?.kind === 'csv' ? 'mapping' : 'preview')
    else if (step === 'mapping') setStep('preview')
  }
  const back = (): void => {
    if (step === 'preview') setStep(file?.kind === 'csv' ? 'mapping' : 'account')
    else if (step === 'mapping') setStep('account')
    else if (step === 'account') setStep('file')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* fixed height so the dialog doesn't jump as steps change content */}
      <DialogContent className="flex h-[520px] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import transactions</DialogTitle>
          <DialogDescription>
            {step === 'file' && 'Choose a CSV, OFX, QFX, or QIF file exported from your bank.'}
            {step === 'account' && 'Pick the account these transactions belong to.'}
            {step === 'mapping' && 'Match the file’s columns to transaction fields.'}
            {step === 'preview' &&
              'Review what will be imported. Nothing is written until you confirm.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'file' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Empty
              className={cn(
                'border border-dashed transition-colors',
                dragging && 'border-primary bg-accent/50'
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                // without this the browser handles the drop itself, which in
                // Electron means trying to open the file in the window
                e.preventDefault()
                setDragging(false)
                const dropped = e.dataTransfer.files[0]
                if (dropped) void dropFile(dropped)
              }}
            >
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={FileImportIcon} />
                </EmptyMedia>
                <EmptyTitle>Drop a file here</EmptyTitle>
                <EmptyDescription>
                  CSV, TSV, OFX, QFX, or QIF exported from your bank
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => pickFile(undefined)}
                  disabled={pick.isPending}
                >
                  {pick.isPending ? 'Reading file…' : 'Choose file…'}
                </Button>
              </EmptyContent>
            </Empty>
            {pick.isError && (
              <p className="max-w-md self-center text-center text-sm text-destructive">
                {ipcErrorMessage(pick.error)}
              </p>
            )}
          </div>
        )}

        {step === 'account' && file && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {file.fileName} ·{' '}
              {file.kind === 'csv'
                ? plural(file.rowCount, 'row')
                : plural(file.rowCount, 'transaction')}
            </p>
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as 'existing' | 'new')}
              viewTransition={false}
            >
              <TabsList>
                <TabsTrigger value="existing">Existing account</TabsTrigger>
                <TabsTrigger value="new">New account</TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === 'existing' ? (
              <Select
                value={accountId === null ? undefined : String(accountId)}
                onValueChange={(v) => setAccountId(Number(v))}
                // without an items map, base-ui's Value renders the raw value —
                // the account id — instead of the label
                items={Object.fromEntries(
                  accounts.map((account) => [String(account.id), accountLabel(account)])
                )}
              >
                <SelectTrigger aria-label="Account" className="w-80">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {accountLabel(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="import-account-name">Name</Label>
                  <Input
                    id="import-account-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Old Checking"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="import-account-currency">Currency</Label>
                    <CurrencySelect value={newCurrency} onChange={setNewCurrency} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="import-account-balance">Opening balance (optional)</Label>
                    <NumberInput
                      id="import-account-balance"
                      // no min: a card's opening balance is negative
                      prefix={currencySymbol(newCurrency) || undefined}
                      value={newBalance}
                      onValueChange={setNewBalance}
                      placeholder="0.00"
                      aria-invalid={balanceInvalid}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  The balance before any of these transactions. The account&rsquo;s current balance
                  is this plus everything you import; leave it blank to start from zero.
                </p>
              </div>
            )}
          </div>
        )}

        {step === 'mapping' && file?.kind === 'csv' && (
          <CsvMappingFields
            headers={file.headers}
            sampleRows={file.sampleRows}
            rowCount={file.rowCount}
            mapping={mapping}
            onChange={setMapping}
          />
        )}

        {step === 'preview' && (
          <ImportPreviewTable
            preview={preview}
            currency={currency}
            isIncluded={isIncluded}
            onToggle={onToggle}
          />
        )}

        {step !== 'file' && (
          <DialogFooter className="sm:justify-between">
            <StepDots count={steps.length} index={steps.indexOf(step)} />
            <div className="flex items-center gap-2">
              {apply.isError && (
                <p className="text-sm text-destructive">{ipcErrorMessage(apply.error)}</p>
              )}
              <Button variant="ghost" className="w-16" onClick={back}>
                Back
              </Button>
              {step === 'account' && (
                <Button className="w-16" onClick={next} disabled={!accountStepReady}>
                  Next
                </Button>
              )}
              {step === 'mapping' && (
                <Button className="w-16" onClick={next} disabled={!csvMapping}>
                  Next
                </Button>
              )}
              {step === 'preview' && (
                <Button
                  onClick={() => apply.mutate()}
                  disabled={selectedCount === 0 || apply.isPending}
                >
                  {apply.isPending
                    ? 'Importing…'
                    : selectedCount === 0
                      ? 'Nothing to import'
                      : `Import ${plural(selectedCount, 'transaction')}`}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// lives with the open state so pages can show it without loading the dialog;
// re-exported for existing importers
export { ImportButton } from '@/lib/import-ui'

// progress dots, same look as the onboarding flow's StepDots
function StepDots({ count, index }: { count: number; index: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-1.5 rounded-full transition-colors',
            i <= index ? 'bg-foreground' : 'bg-muted-foreground/30'
          )}
        />
      ))}
    </div>
  )
}

// ISO 4217 list-one records, one per code, alphabetical for scanability
const CURRENCIES = [...new Map(currencyData.map((c) => [c.code, c])).values()].sort((a, b) =>
  a.code.localeCompare(b.code)
)

/** Searchable ISO 4217 picker; value is the 3-letter code (matches accounts.currency) */
function CurrencySelect({
  value,
  onChange
}: {
  value: string
  onChange: (code: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = CURRENCIES.find((c) => c.code === value)
  return (
    // modal: the popover portals outside the DialogContent, and the modal
    // dialog's scroll lock would otherwise swallow wheel events over the list
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id="import-account-currency"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">
          {selected ? `${selected.code} — ${selected.currency}` : value}
        </span>
        <HugeiconsIcon icon={UnfoldMoreIcon} size={14} className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search currencies..." />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {CURRENCIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.currency}`}
                  onSelect={() => {
                    onChange(c.code)
                    setOpen(false)
                  }}
                  checked={value === c.code}
                >
                  {c.code}
                  <span className="truncate text-muted-foreground">{c.currency}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function columnLabel(headers: string[], index: number): string {
  return headers[index]?.trim() || `Column ${index + 1}`
}

function ColumnSelect({
  id,
  headers,
  value,
  onChange,
  extraOption
}: {
  id: string
  headers: string[]
  value: number | null
  onChange: (index: number) => void
  /** an option beyond the columns; `selected` shows it as the current choice */
  extraOption?: { value: string; label: string; selected: boolean; onSelect: () => void }
}): React.JSX.Element {
  return (
    <Select
      value={extraOption?.selected ? extraOption.value : value === null ? undefined : String(value)}
      onValueChange={(v) => {
        if (extraOption && v === extraOption.value) extraOption.onSelect()
        else onChange(Number(v))
      }}
      // without an items map, base-ui's Value renders the raw value — the
      // column index — instead of the header name
      items={{
        ...Object.fromEntries(headers.map((_, i) => [String(i), columnLabel(headers, i)])),
        ...(extraOption && { [extraOption.value]: extraOption.label })
      }}
    >
      <SelectTrigger id={id} className="w-56">
        <SelectValue placeholder="Select a column" />
      </SelectTrigger>
      <SelectContent>
        {headers.map((_, i) => (
          <SelectItem key={i} value={String(i)}>
            {columnLabel(headers, i)}
          </SelectItem>
        ))}
        {extraOption && <SelectItem value={extraOption.value}>{extraOption.label}</SelectItem>}
      </SelectContent>
    </Select>
  )
}

/** every role has a column; until then the mapping can't preview or import */
function mappingComplete(mapping: CsvMapping): boolean {
  const { amount } = mapping
  const columns =
    amount.kind === 'single' ? [amount.column] : [amount.debitColumn, amount.creditColumn]
  return [mapping.dateColumn, mapping.descriptionColumn, ...columns].every((c) => c >= 0)
}

function CsvMappingFields({
  headers,
  sampleRows,
  rowCount,
  mapping,
  onChange
}: {
  headers: string[]
  sampleRows: string[][]
  rowCount: number
  mapping: CsvMapping | null
  onChange: (mapping: CsvMapping) => void
}): React.JSX.Element {
  const invertId = useId()
  const dateId = useId()
  const dateFormatId = useId()
  const descriptionId = useId()
  const amountId = useId()
  const debitId = useId()
  const creditId = useId()
  // partial edits need somewhere to live before every role is filled, so unset
  // roles hold a sentinel -1 (see mappingComplete)
  const base: CsvMapping = mapping ?? {
    dateColumn: -1,
    dateFormat: CSV_DATE_FORMATS[0],
    descriptionColumn: -1,
    amount: { kind: 'single', column: -1, invert: false }
  }
  const set = (patch: Partial<CsvMapping>): void => onChange({ ...base, ...patch })
  const single = base.amount.kind === 'single' ? base.amount : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={dateId}>Date</Label>
          <ColumnSelect
            id={dateId}
            headers={headers}
            value={base.dateColumn === -1 ? null : base.dateColumn}
            onChange={(dateColumn) => set({ dateColumn })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={dateFormatId}>Date format</Label>
          <Select
            value={base.dateFormat}
            onValueChange={(dateFormat) => set({ dateFormat: dateFormat as string })}
          >
            <SelectTrigger id={dateFormatId} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CSV_DATE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={descriptionId}>Description</Label>
          <ColumnSelect
            id={descriptionId}
            headers={headers}
            value={base.descriptionColumn === -1 ? null : base.descriptionColumn}
            onChange={(descriptionColumn) => set({ descriptionColumn })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={amountId}>Amount</Label>
          <ColumnSelect
            id={amountId}
            headers={headers}
            value={single && single.column !== -1 ? single.column : null}
            onChange={(column) =>
              set({ amount: { kind: 'single', column, invert: single?.invert ?? false } })
            }
            extraOption={{
              value: 'debitCredit',
              label: 'Separate debit / credit columns',
              selected: base.amount.kind === 'debitCredit',
              onSelect: () =>
                set({ amount: { kind: 'debitCredit', debitColumn: -1, creditColumn: -1 } })
            }}
          />
        </div>
        {single && (
          // debit/credit columns state the direction themselves; one column may
          // follow the opposite convention from this app, which turns the whole
          // file backwards. Flipping keeps each row's direction relative to the
          // others, so a file that does carry both signs stays coherent.
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor={invertId}>Flip the sign of every amount</Label>
              <p className="text-xs text-muted-foreground">
                For files where money out is written as positive
              </p>
            </div>
            <Switch
              id={invertId}
              checked={single.invert}
              onCheckedChange={(invert) => set({ amount: { ...single, invert } })}
            />
          </div>
        )}
        {base.amount.kind === 'debitCredit' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={debitId}>Debit (money out)</Label>
              <ColumnSelect
                id={debitId}
                headers={headers}
                value={base.amount.debitColumn === -1 ? null : base.amount.debitColumn}
                onChange={(debitColumn) =>
                  set({
                    amount: {
                      ...(base.amount as {
                        kind: 'debitCredit'
                        debitColumn: number
                        creditColumn: number
                      }),
                      debitColumn
                    }
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={creditId}>Credit (money in)</Label>
              <ColumnSelect
                id={creditId}
                headers={headers}
                value={base.amount.creditColumn === -1 ? null : base.amount.creditColumn}
                onChange={(creditColumn) =>
                  set({
                    amount: {
                      ...(base.amount as {
                        kind: 'debitCredit'
                        debitColumn: number
                        creditColumn: number
                      }),
                      creditColumn
                    }
                  })
                }
              />
            </div>
          </>
        )}
      </div>

      {/* raw data sample so the column roles can be matched by sight */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          First {sampleRows.length} of {plural(rowCount, 'row')}
        </p>
        <ScrollArea horizontal className="rounded-md border">
          <table className="w-full text-xs">
            <TableHeader className="sticky top-0 z-10 bg-popover shadow-[inset_0_-1px_0_0_var(--border)] [&_tr]:border-b-0">
              <TableRow className="hover:bg-transparent">
                {headers.map((_, i) => (
                  <TableHead
                    key={i}
                    className="whitespace-nowrap font-normal text-muted-foreground"
                  >
                    {columnLabel(headers, i)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sampleRows.map((row, i) => (
                <TableRow key={i}>
                  {headers.map((_, col) => (
                    <TableCell key={col} className="max-w-48 truncate whitespace-nowrap">
                      {row[col] ?? ''}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </table>
        </ScrollArea>
      </div>
    </div>
  )
}

// h-10 cells plus the row's bottom border; rows are measured once rendered
const PREVIEW_ROW_HEIGHT = 41

const PreviewTableRow = memo(function PreviewTableRow({
  row,
  index,
  checked,
  currency,
  onToggle,
  measureRef
}: {
  row: PreviewRow
  index: number
  checked: boolean
  currency: string
  onToggle: (row: PreviewRow, checked: boolean) => void
  measureRef: (element: HTMLTableRowElement | null) => void
}): React.JSX.Element {
  return (
    <TableRow
      ref={measureRef}
      data-index={index}
      className={cn(row.status === 'duplicate' && 'opacity-50')}
    >
      <TableCell className="pr-0">
        {row.status !== 'duplicate' && (
          <Checkbox
            checked={checked}
            onCheckedChange={(next) => onToggle(row, next === true)}
            aria-label="Include in import"
          />
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{row.dateLabel}</TableCell>
      <TableCell className="max-w-0 truncate">{row.description}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Amount value={row.amount} currency={currency} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {row.status === 'duplicate' && <Badge variant="secondary">Duplicate</Badge>}
        {row.status === 'probable' && <Badge variant="outline">Possible duplicate</Badge>}
      </TableCell>
    </TableRow>
  )
})

function ImportPreviewTable({
  preview,
  currency,
  isIncluded,
  onToggle
}: {
  preview: UseQueryResult<PreviewData>
  currency: string
  isIncluded: (row: PreviewRow) => boolean
  onToggle: (row: PreviewRow, checked: boolean) => void
}): React.JSX.Element {
  // the virtualizer is a mutable instance the compiler can't see change
  'use no memo'
  const viewportRef = useRef<HTMLDivElement>(null)
  const rows = preview.data?.rows ?? []
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => PREVIEW_ROW_HEIGHT,
    getItemKey: (index) => rows[index].externalId,
    overscan: 10
  })

  if (preview.isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Checking transactions…</p>
  }
  if (preview.isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">{ipcErrorMessage(preview.error)}</p>
    )
  }
  const errors = preview.data?.errors ?? []
  const duplicates = preview.data?.duplicateCount ?? 0
  // every row that isn't new carries a status badge
  const anyBadges = rows.length > (preview.data?.newCount ?? 0)

  // only the rows in view are mounted; spacer rows stand in for the rest so the
  // scrollbar and sticky header behave as if the whole table were there
  const items = virtualizer.getVirtualItems()
  const padTop = items.length > 0 ? items[0].start : 0
  const padBottom = items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {(errors.length > 0 || duplicates > 0) && (
        <p className="text-sm text-muted-foreground">
          {[
            errors.length > 0 &&
              `${plural(errors.length, 'row')} couldn’t be read (e.g. line ${errors[0].line}: ${errors[0].message})`,
            duplicates > 0 && `${plural(duplicates, 'duplicate')} will be skipped`
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No transactions found in the file.
        </p>
      ) : (
        <ScrollArea
          className="-mx-4 min-h-0 flex-1 [--table-edge:1rem]"
          viewPortClassName="h-full"
          viewportRef={viewportRef}
        >
          <table className={cn('w-full caption-bottom text-xs', TABLE_BLEED)}>
            <TableHeader className="sticky top-0 z-10 bg-popover shadow-[inset_0_-1px_0_0_var(--border)] [&_tr]:border-b-0">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8" />
                {/* widths hold the columns steady as rows mount and unmount */}
                <TableHead className="w-24 font-normal text-muted-foreground">Date</TableHead>
                <TableHead className="w-full font-normal text-muted-foreground">
                  Description
                </TableHead>
                <TableHead className="w-28 text-right font-normal text-muted-foreground">
                  Amount
                </TableHead>
                <TableHead className={cn('font-normal text-muted-foreground', anyBadges && 'w-36')}>
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b!">
              {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
              {items.map((item) => {
                const row = rows[item.index]
                return (
                  <PreviewTableRow
                    key={row.externalId}
                    row={row}
                    index={item.index}
                    checked={isIncluded(row)}
                    currency={currency}
                    onToggle={onToggle}
                    measureRef={virtualizer.measureElement}
                  />
                )
              })}
              {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
            </TableBody>
          </table>
        </ScrollArea>
      )}
    </div>
  )
}
