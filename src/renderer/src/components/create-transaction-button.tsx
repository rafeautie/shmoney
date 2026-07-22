import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'

/** The one Create transaction toggle, so it looks the same on every page:
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
      <HugeiconsIcon icon={Add01Icon} size={16} />
      Create transaction
    </Button>
  )
}
