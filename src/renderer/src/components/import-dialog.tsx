import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  CSV_DATE_FORMATS,
  type CsvMapping,
  type ImportPreview,
  type ImportPreviewInput,
  type PickFileResult
} from '@shared/import'
import { HugeiconsIcon } from '@hugeicons/react'
import { FileImportIcon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { data as currencyData } from 'currency-codes'
import { cn, ipcErrorMessage, plural, TABLE_BLEED } from '@/lib/utils'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type PickedFile = Exclude<PickFileResult, null>
type Step = 'file' | 'account' | 'mapping' | 'preview'

/** how many raw rows the column-matching step shows as a sample */
const MAPPING_SAMPLE_ROWS = 3

export function ImportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  /** externalId -> include in the import (duplicates are excluded regardless) */
  const [included, setIncluded] = useState<Record<string, boolean>>({})

  // a stale file/selection must never carry over into the next import
  useEffect(() => {
    if (!open) return
    setStep('file')
    setFile(null)
    setMapping(null)
    setMode('existing')
    setAccountId(null)
    setNewName('')
    setNewCurrency('USD')
    setNewBalance('')
    setIncluded({})
  }, [open])

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list(),
    enabled: open
  })
  const accounts = accountsQuery.data ?? []

  const pick = useMutation({
    mutationFn: (dropped?: { fileName: string; bytes: Uint8Array }) =>
      window.api.import.pickFile(dropped ? { dropped } : undefined),
    onSuccess: (result) => {
      if (!result) return // canceled the native dialog
      setFile(result)
      setMapping(result.kind === 'csv' ? result.suggestedMapping : null)
      setStep('account')
    }
  })

  const [dragging, setDragging] = useState(false)
  const dropFile = async (dropped: File): Promise<void> => {
    const bytes = new Uint8Array(await dropped.arrayBuffer())
    pick.mutate({ fileName: dropped.name, bytes })
  }

  const previewInput: ImportPreviewInput | null = useMemo(() => {
    if (!file) return null
    if (file.kind === 'csv') {
      if (!mapping) return null
      return {
        source: { csv: { headers: file.headers, rows: file.rows, mapping } },
        accountId: mode === 'existing' && accountId !== null ? accountId : undefined
      }
    }
    return {
      source: { rows: file.rows },
      accountId: mode === 'existing' && accountId !== null ? accountId : undefined
    }
  }, [file, mapping, mode, accountId])

  const preview = useQuery({
    // key on the inputs that change the result, not the (large) row data — the
    // rows are fixed once a file is picked
    queryKey: ['import', 'preview', file?.fileName, mapping, mode, accountId],
    queryFn: () => window.api.import.preview(previewInput!),
    enabled: open && step === 'preview' && previewInput !== null,
    staleTime: 0,
    gcTime: 0
  })

  // default selection: new rows in, probable duplicates opt-in, exact ones out
  useEffect(() => {
    if (!preview.data) return
    const next: Record<string, boolean> = {}
    for (const row of preview.data.rows) next[row.externalId] = row.status === 'new'
    setIncluded(next)
  }, [preview.data])

  const selectedRows = (preview.data?.rows ?? []).filter(
    (row) => row.status !== 'duplicate' && included[row.externalId]
  )

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
    mutationFn: () => {
      const rows = selectedRows.map(({ status: _status, ...row }) => row)
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
      return window.api.import.apply({ rows, target })
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
    onSettled: () => queryClient.invalidateQueries()
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
                  onClick={() => pick.mutate(undefined)}
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
                ? plural(file.rows.length, 'row')
                : plural(file.rows.length, 'transaction')}
            </p>
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'existing' | 'new')}>
              <TabsList>
                <TabsTrigger value="existing">Existing account</TabsTrigger>
                <TabsTrigger value="new">New account</TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === 'existing' ? (
              <Select
                value={accountId === null ? undefined : String(accountId)}
                onValueChange={(v) => setAccountId(Number(v))}
              >
                <SelectTrigger className="w-80">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.institutionName ? `${account.institutionName} · ` : ''}
                      {account.name}
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
                    <Label htmlFor="import-account-balance">Current balance (optional)</Label>
                    <Input
                      id="import-account-balance"
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      placeholder="0.00"
                      aria-invalid={balanceInvalid}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'mapping' && file?.kind === 'csv' && (
          <CsvMappingFields
            headers={file.headers}
            rows={file.rows}
            mapping={mapping}
            onChange={setMapping}
          />
        )}

        {step === 'preview' && (
          <ImportPreviewTable
            preview={preview}
            currency={currency}
            included={included}
            onToggle={(externalId, value) =>
              setIncluded((prev) => ({ ...prev, [externalId]: value }))
            }
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
                <Button className="w-16" onClick={next} disabled={!mapping}>
                  Next
                </Button>
              )}
              {step === 'preview' && (
                <Button
                  onClick={() => apply.mutate()}
                  disabled={selectedRows.length === 0 || apply.isPending}
                >
                  {apply.isPending
                    ? 'Importing…'
                    : selectedRows.length === 0
                      ? 'Nothing to import'
                      : `Import ${plural(selectedRows.length, 'transaction')}`}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

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
      <PopoverTrigger asChild>
        <Button
          id="import-account-currency"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.currency}` : value}
          </span>
          <HugeiconsIcon icon={UnfoldMoreIcon} size={14} className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
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
                >
                  {c.code}
                  <span className="truncate text-muted-foreground">{c.currency}</span>
                  {value === c.code && (
                    <HugeiconsIcon icon={Tick02Icon} size={14} className="ml-auto" />
                  )}
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
  headers,
  value,
  onChange,
  extraOption
}: {
  headers: string[]
  value: number | null
  onChange: (index: number) => void
  extraOption?: { value: string; label: string; onSelect: () => void }
}): React.JSX.Element {
  return (
    <Select
      value={value === null ? undefined : String(value)}
      onValueChange={(v) => {
        if (extraOption && v === extraOption.value) extraOption.onSelect()
        else onChange(Number(v))
      }}
    >
      <SelectTrigger className="w-56">
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

function CsvMappingFields({
  headers,
  rows,
  mapping,
  onChange
}: {
  headers: string[]
  rows: string[][]
  mapping: CsvMapping | null
  onChange: (mapping: CsvMapping) => void
}): React.JSX.Element {
  // partial edits need somewhere to live before every role is filled; fall back
  // to sentinel -1 indexes and only emit complete mappings upward
  const base: CsvMapping = mapping ?? {
    dateColumn: -1,
    dateFormat: CSV_DATE_FORMATS[0],
    descriptionColumn: -1,
    amount: { kind: 'single', column: -1 }
  }
  const set = (patch: Partial<CsvMapping>): void => onChange({ ...base, ...patch })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <Label>Date</Label>
          <ColumnSelect
            headers={headers}
            value={base.dateColumn === -1 ? null : base.dateColumn}
            onChange={(dateColumn) => set({ dateColumn })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label>Date format</Label>
          <Select value={base.dateFormat} onValueChange={(dateFormat) => set({ dateFormat })}>
            <SelectTrigger className="w-56">
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
          <Label>Description</Label>
          <ColumnSelect
            headers={headers}
            value={base.descriptionColumn === -1 ? null : base.descriptionColumn}
            onChange={(descriptionColumn) => set({ descriptionColumn })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label>Amount</Label>
          <ColumnSelect
            headers={headers}
            value={
              base.amount.kind === 'single' && base.amount.column !== -1 ? base.amount.column : null
            }
            onChange={(column) => set({ amount: { kind: 'single', column } })}
            extraOption={{
              value: 'debitCredit',
              label: 'Separate debit / credit columns',
              onSelect: () =>
                set({ amount: { kind: 'debitCredit', debitColumn: -1, creditColumn: -1 } })
            }}
          />
        </div>
        {base.amount.kind === 'debitCredit' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label>Debit (money out)</Label>
              <ColumnSelect
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
              <Label>Credit (money in)</Label>
              <ColumnSelect
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
          First {Math.min(rows.length, MAPPING_SAMPLE_ROWS)} of {plural(rows.length, 'row')}
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
              {rows.slice(0, MAPPING_SAMPLE_ROWS).map((row, i) => (
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

function ImportPreviewTable({
  preview,
  currency,
  included,
  onToggle
}: {
  preview: UseQueryResult<ImportPreview>
  currency: string
  included: Record<string, boolean>
  onToggle: (externalId: string, value: boolean) => void
}): React.JSX.Element {
  if (preview.isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Checking transactions…</p>
  }
  if (preview.isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">{ipcErrorMessage(preview.error)}</p>
    )
  }
  const rows = preview.data?.rows ?? []
  const errors = preview.data?.errors ?? []
  const duplicates = rows.filter((r) => r.status === 'duplicate').length

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
        <ScrollArea className="-mx-4 min-h-0 flex-1 [--table-edge:1rem]" viewPortClassName="h-full">
          <table className={cn('w-full caption-bottom text-xs', TABLE_BLEED)}>
            <TableHeader className="sticky top-0 z-10 bg-popover shadow-[inset_0_-1px_0_0_var(--border)] [&_tr]:border-b-0">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8" />
                <TableHead className="font-normal text-muted-foreground">Date</TableHead>
                <TableHead className="w-full font-normal text-muted-foreground">
                  Description
                </TableHead>
                <TableHead className="text-right font-normal text-muted-foreground">
                  Amount
                </TableHead>
                <TableHead className="font-normal text-muted-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b!">
              {rows.map((row) => (
                <TableRow
                  key={row.externalId}
                  className={cn(row.status === 'duplicate' && 'opacity-50')}
                >
                  <TableCell>
                    {row.status !== 'duplicate' && (
                      <Checkbox
                        checked={included[row.externalId] ?? false}
                        onCheckedChange={(checked) => onToggle(row.externalId, checked === true)}
                        aria-label="Include in import"
                      />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {format(new Date(row.posted * 1000), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="max-w-0 truncate">{row.description}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Amount value={row.amount} currency={currency} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.status === 'duplicate' && <Badge variant="secondary">Duplicate</Badge>}
                    {row.status === 'probable' && (
                      <Badge variant="outline">Possible duplicate</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </ScrollArea>
      )}
    </div>
  )
}
