import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { toast } from 'sonner'
import type { RulePreviewGroup } from '@shared/rules'
import { cn, formatAmount, ipcErrorMessage, plural, TABLE_BLEED } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  const navigate = useNavigate()

  const previewQuery = useQuery({
    queryKey: ['rules', 'preview'],
    queryFn: () => window.api.rules.preview(),
    enabled: open,
    staleTime: 0,
    gcTime: 0
  })

  const groups = previewQuery.data ?? []
  const total = groups.reduce((sum, g) => sum + g.transactions.length, 0)

  const apply = useMutation({
    mutationFn: () => window.api.rules.apply(),
    onSuccess: (result) => {
      onOpenChange(false)
      const changed = result.categorized + result.markedTransfer
      toast(changed > 0 ? `Applied rules to ${plural(changed, 'transaction')}` : 'No transactions changed', {
        description: changed > 0 ? 'Review or undo them from the Activity page.' : undefined,
        action:
          changed > 0
            ? { label: 'Review', onClick: () => navigate({ to: '/activity' }) }
            : undefined
      })
    },
    onSettled: () => queryClient.invalidateQueries()
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col sm:max-w-2xl">
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
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions match your rules right now.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <PreviewGroup key={group.ruleId} group={group} />
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={total === 0 || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? 'Applying…' : total === 0 ? 'Nothing to apply' : `Apply to ${total}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewGroup({ group }: { group: RulePreviewGroup }): React.JSX.Element {
  const isTransfer = group.action.type === 'markTransfer'
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
              <span className="text-xs font-normal text-muted-foreground">
                {isTransfer ? '→ Mark as transfer' : '→ Set category'}
              </span>
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
            <TableCell className="whitespace-nowrap text-muted-foreground">{t.accountName}</TableCell>
            <TableCell className="max-w-0 truncate">{t.description}</TableCell>
            <TableCell className="text-right whitespace-nowrap tabular-nums">
              {formatAmount(t.amount, t.currency)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {isTransfer ? 'Transfer' : (t.targetCategoryName ?? '—')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </table>
  )
}
