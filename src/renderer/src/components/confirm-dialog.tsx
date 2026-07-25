import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { CornerDownLeftIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/** What to confirm and what to do about it — shared by the dialog and the button
 * that opens it. */
export interface ConfirmProps {
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  pendingLabel?: string
  confirmVariant?: React.ComponentProps<typeof Button>['variant']
  pending?: boolean
  /** `close` dismisses the dialog; hand it to an async action's success callback
   * so a failed action leaves the dialog open. */
  onConfirm: (close: () => void) => void
}

/** The single confirmation pattern for destructive actions: a modal dialog with a
 * title, an explanation, and Cancel / confirm buttons. Controlled via open/onOpenChange.
 * The confirm button is destructive by default; pass `pendingLabel` to show progress
 * text while the action runs (the button is disabled whenever `pending` is true).
 *
 * Prefer <ConfirmButton> when a button opens this; reach for the dialog directly when
 * the entry point is something else (a menu item, a keyboard shortcut, a row action
 * whose target varies) or when it must outlive its trigger.
 *
 * Keyboard: Escape cancels (base-ui default) and Enter confirms — the body is a form
 * whose submit button is the confirm action, and it takes initial focus so a bare Enter
 * fires it. Each button shows its key as a cap so the shortcut is discoverable. */
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
}: ConfirmProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-lg" initialFocus={confirmRef}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending) onConfirm(() => onOpenChange(false))
          }}
          onKeyDown={(event) => {
            // Escape cancels. base-ui's built-in escape-to-close does not fire
            // reliably here, so close it ourselves; harmless if base-ui also does.
            if (event.key === 'Escape' && !pending) {
              event.preventDefault()
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="max-w-11/12">{title}</DialogTitle>
            {description != null && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
              <KeyHint>Esc</KeyHint>
            </Button>
            <Button ref={confirmRef} type="submit" variant={confirmVariant} disabled={pending}>
              {pending && pendingLabel ? pendingLabel : confirmLabel}
              <KeyHint>
                <HugeiconsIcon icon={CornerDownLeftIcon} className="size-3" strokeWidth={2} />
              </KeyHint>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A destructive action as one component: the button that starts it plus the
 * confirmation it has to pass. Remaining props style the trigger, so
 * `<ConfirmButton variant="destructive" title="Delete X?" onConfirm={…}>Delete</ConfirmButton>`
 * replaces the usual button + open state + <ConfirmDialog> trio. An `onClick`
 * still runs on press, before the dialog opens. */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmVariant,
  pending,
  onConfirm,
  onClick,
  ...buttonProps
}: ConfirmProps & Omit<React.ComponentProps<typeof Button>, 'title'>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        {...buttonProps}
        onClick={(event) => {
          onClick?.(event)
          setOpen(true)
        }}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        pendingLabel={pendingLabel}
        confirmVariant={confirmVariant}
        pending={pending}
        onConfirm={onConfirm}
      />
    </>
  )
}

// a small keycap that labels which key triggers a button; inherits the button's
// text color so it reads on both the outline and destructive variants
function KeyHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="pointer-events-none inline-flex h-4 min-w-4 items-center justify-center rounded border border-current/30 px-1 font-sans text-[0.625rem] leading-none opacity-70">
      {children}
    </kbd>
  )
}
