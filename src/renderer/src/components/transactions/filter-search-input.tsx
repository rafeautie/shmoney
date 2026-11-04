import { useEffect, useEffectEvent, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'

/** Broad search box: debounced while typing so each keystroke doesn't hit SQL.
 * `collapsible` folds an empty box to an icon button until it's wanted. */
export function FilterSearchInput({
  value,
  onChange,
  placeholder = 'Search transactions…',
  collapsible = false
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  placeholder?: string
  collapsible?: boolean
}) {
  const [text, setText] = useState(value ?? '')
  const [expanded, setExpanded] = useState(false)

  // reflect external changes (saved-filter load, reset) without clobbering
  // in-progress typing after our own debounced commit lands; state is adjusted
  // during render per https://react.dev/learn/you-might-not-need-an-effect
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (text.trim() !== (value ?? '')) setText(value ?? '')
  }

  // an effect event, so a parent re-render (a fresh inline onChange) mid-typing
  // doesn't restart the debounce
  const commit = useEffectEvent((next: string | undefined) => onChange(next))

  useEffect(() => {
    const trimmed = text.trim()
    const next = trimmed === '' ? undefined : trimmed
    if (next === value) return undefined
    const timer = setTimeout(() => commit(next), 300)
    return () => clearTimeout(timer)
  }, [text, value])

  if (collapsible && !expanded && text === '') {
    return (
      <Button
        variant="field"
        size="icon-lg"
        aria-label={placeholder}
        onClick={() => setExpanded(true)}
      >
        <HugeiconsIcon icon={Search01Icon} className="size-3.5 text-muted-foreground" />
      </Button>
    )
  }

  return (
    <InputGroup className="h-8 w-56">
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} size={14} />
      </InputGroupAddon>
      <InputGroupInput
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        // opened from the icon: ready to type, and folds away again if left empty
        autoFocus={collapsible && expanded}
        onBlur={() => {
          if (collapsible && text.trim() === '') setExpanded(false)
        }}
      />
    </InputGroup>
  )
}
