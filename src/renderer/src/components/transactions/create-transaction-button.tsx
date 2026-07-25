import { Button } from '@/components/ui/button'

/** The one New Transaction toggle, so it looks the same on every page. Idle it
 * is the only solid button in the header, which sets it apart from the outline
 * actions next to it; while the entry row is shown it drops to secondary
 * (pressed) and reads Cancel, so the second click is plainly a close. */
export function CreateTransactionButton({
  creating,
  onToggle
}: {
  creating: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <Button
      variant={creating ? 'secondary' : 'default'}
      aria-pressed={creating}
      className="shrink-0"
      onClick={onToggle}
    >
      {creating ? 'Cancel' : 'New Transaction'}
    </Button>
  )
}
