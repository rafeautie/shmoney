import { Button } from '@/components/ui/button'

/** The one New Transaction toggle, so it looks the same on every page:
 * outline while idle, secondary (pressed) while the entry row is shown. */
export function CreateTransactionButton({
  creating,
  onToggle
}: {
  creating: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <Button
      variant={creating ? 'secondary' : 'outline'}
      aria-pressed={creating}
      className="shrink-0"
      onClick={onToggle}
    >
      New Transaction
    </Button>
  )
}
