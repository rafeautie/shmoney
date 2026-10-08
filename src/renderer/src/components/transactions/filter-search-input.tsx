import { useEffect, useEffectEvent, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'

/** Broad search box: debounced while typing so each keystroke doesn't hit SQL */
export function FilterSearchInput({
  value,
  onChange,
  placeholder = 'Search transactions...'
}: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  placeholder?: string
}) {
  const [text, setText] = useState(value ?? '')

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

  return (
    <InputGroup className="h-7 w-56">
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} size={14} />
      </InputGroupAddon>
      <InputGroupInput
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </InputGroup>
  )
}
