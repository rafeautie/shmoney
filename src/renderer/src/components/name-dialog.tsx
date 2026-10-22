import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ipcErrorMessage } from '@/lib/utils'

/**
 * The edit dialog for things whose only field is a name (accounts, reports,
 * conversations), so they edit the same way goals and envelopes do: from the
 * actions menu, never in place. Save stays off for an empty name, an
 * unchanged one just closes, and a failed save keeps the dialog open with
 * the error.
 */
export function NameDialog({
  open,
  onOpenChange,
  ...formProps
}: NameFormProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-100">
        {/* DialogContent unmounts on close, so each open starts from `name` */}
        <NameForm {...formProps} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

interface NameFormProps {
  title: string
  description?: React.ReactNode
  /** the current name; the field starts from it */
  name: string
  placeholder?: string
  maxLength?: number
  /** resolves once saved; the dialog closes then, or shows the error */
  onSave: (name: string) => Promise<unknown>
}

function NameForm({
  title,
  description,
  name,
  placeholder,
  maxLength = 200,
  onSave,
  onDone
}: NameFormProps & { onDone: () => void }) {
  const [draft, setDraft] = useState(name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const next = draft.trim()
  const canSubmit = next !== '' && !pending

  const save = (): void => {
    if (!canSubmit) return
    if (next === name) return onDone()
    setPending(true)
    setError(null)
    onSave(next).then(onDone, (e: unknown) => {
      setPending(false)
      setError(e)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="name-dialog-name">Name</Label>
        <Input
          id="name-dialog-name"
          autoFocus
          // select the old name so typing replaces it
          onFocus={(e) => e.currentTarget.select()}
          placeholder={placeholder}
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        {error !== null && <p className="text-xs text-destructive">{ipcErrorMessage(error)}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={save}>
          {pending ? 'Saving...' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}
