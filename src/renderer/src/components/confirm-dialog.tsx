import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/** The single confirmation pattern for destructive actions: a modal dialog with a
 * title, an explanation, and Cancel / confirm buttons. Controlled via open/onOpenChange.
 * The confirm button is destructive by default; pass `pendingLabel` to show progress
 * text while the action runs (the button is disabled whenever `pending` is true). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  pendingLabel,
  confirmVariant = 'destructive',
  pending = false,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  pendingLabel?: string
  confirmVariant?: React.ComponentProps<typeof Button>['variant']
  pending?: boolean
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-lg">
        <DialogHeader>
          <DialogTitle className="max-w-11/12">{title}</DialogTitle>
          {description != null && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={confirmVariant} disabled={pending} onClick={onConfirm}>
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
