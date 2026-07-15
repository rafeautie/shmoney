import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { SearchRemoveIcon } from '@hugeicons/core-free-icons'
import type { RulePreviewGroup } from '@shared/rules'
import { cn, ipcErrorMessage, plural, TABLE_BLEED } from '@/lib/utils'
import { Amount } from '@/components/amount'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function RulesPreviewDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()

  // opt-in overwrite of already-set categories; reset each time the dialog opens
  // so a destructive choice never silently carries over to the next apply
  const [overrideCategories, setOverrideCategories] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset on reopen; the extra render on a closed->open transition is harmless
    if (open) setOverrideCategories(false)
  }, [open])

  const previewQuery = useQuery({
    queryKey: ['rules', 'preview', overrideCategories],
    queryFn: () => window.api.rules.preview({ overrideCategories }),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    // keep the current preview on screen while toggling override re-runs it, so
    // the dialog updates in place instead of flashing the "Checking…" state
    placeholderData: keepPreviousData
  })

  const groups = previewQuery.data ?? []
  const total = groups.reduce((sum, g) => sum + g.transactions.length, 0)

  const apply = useMutation({
    mutationFn: () => window.api.rules.apply({ overrideCategories }),
    onSuccess: () => {
      onOpenChange(false)
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col min-w-4xl">
        <DialogHeader>
          <DialogTitle>Apply rules</DialogTitle>
          <DialogDescription>
            A dry run of what your rules would change. Nothing is written until you confirm.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-4 [--table-edge:1rem]" viewPortClassName="max-h-[60vh]">
          {previewQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Checking transactions…</p>
          ) : previewQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {ipcErrorMessage(previewQuery.error)}
            </p>
          ) : total === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={SearchRemoveIcon} />
                </EmptyMedia>
                <EmptyDescription>No transactions match your rules right now.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <PreviewGroup key={group.ruleId} group={group} />
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="override-categories"
              checked={overrideCategories}
              onCheckedChange={(checked) => setOverrideCategories(checked === true)}
            />
            <Label htmlFor="override-categories" className="text-sm font-normal">
              Override existing categories
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={total === 0 || apply.isPending} onClick={() => apply.mutate()}>
              {apply.isPending
                ? 'Applying…'
                : total === 0
                  ? 'Nothing to apply'
                  : `Apply to ${total}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewGroup({ group }: { group: RulePreviewGroup }): React.JSX.Element {
  return (
    <table className={cn('w-full caption-bottom text-xs', TABLE_BLEED)}>
      {/* sticky so the rule label + column headers stay pinned while the rows
          scroll; the box-shadow stands in for the border, which collapses away
          while the header is sticky */}
      <TableHeader className="sticky top-0 z-10 bg-popover shadow-[inset_0_-1px_0_0_var(--border)] [&_tr]:border-b-0">
        <TableRow className="hover:bg-transparent">
          <TableHead colSpan={5} className="h-auto pt-1 pb-2">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{group.ruleName}</span>
              <Badge variant="secondary">{plural(group.transactions.length, 'transaction')}</Badge>
              <span className="text-xs font-normal text-muted-foreground">→ Set category</span>
            </span>
          </TableHead>
        </TableRow>
        <TableRow className="hover:bg-transparent">
          <TableHead className="font-normal text-muted-foreground">Date</TableHead>
          <TableHead className="font-normal text-muted-foreground">Account</TableHead>
          <TableHead className="w-full font-normal text-muted-foreground">Description</TableHead>
          <TableHead className="text-right font-normal text-muted-foreground">Amount</TableHead>
          <TableHead className="font-normal text-muted-foreground">Becomes</TableHead>
        </TableRow>
      </TableHeader>
      {/* the ! outweighs the base last-row border-0 rule, which shares specificity */}
      <TableBody className="[&_tr:last-child]:border-b!">
        {group.transactions.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {t.date ? format(new Date(t.date * 1000), 'MMM d') : '—'}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {t.accountName}
            </TableCell>
            <TableCell className="max-w-0 truncate">{t.description}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
              <Amount value={t.amount} currency={t.currency} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {t.currentCategoryName && t.currentCategoryName !== t.targetCategoryName ? (
                <span>
                  <span className="text-muted-foreground line-through">
                    {t.currentCategoryName}
                  </span>
                  {' → '}
                  {t.targetCategoryName ?? '—'}
                </span>
              ) : (
                (t.targetCategoryName ?? '—')
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </table>
  )
}
