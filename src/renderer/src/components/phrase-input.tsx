import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, PencilEdit02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// A controlled multi-value chip input matching the category editor: each value is
// a chip whose edit/delete controls reveal on hover/focus, and a trailing inline
// row adds new values. Edit state is local — the parent owns the array via
// onChange.
//
// This renders inside the rule editor's own <form>, so it deliberately uses NO
// nested <form> (invalid HTML) and every button is type="button": otherwise a
// click (or Enter) would submit the outer rule form instead of adding/editing a
// phrase. Enter is handled explicitly on the inputs.
export function PhraseInput({
  value,
  onChange,
  placeholder,
  maxLength = 200
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  maxLength?: number
}): React.JSX.Element {
  const [adding, setAdding] = useState('')

  function add(): void {
    const phrase = adding.trim()
    // dedupe case-insensitively so we never add a redundant OR term
    if (phrase && !value.some((v) => v.toLowerCase() === phrase.toLowerCase())) {
      onChange([...value, phrase])
    }
    setAdding('')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((phrase, index) => (
        <PhraseChip
          // index key so the chip keeps its edit state across a rename (the phrase
          // itself changes); dedupe keeps the list free of duplicates
          key={index}
          phrase={phrase}
          maxLength={maxLength}
          onRename={(next) => onChange(value.map((p, i) => (i === index ? next : p)))}
          onDelete={() => onChange(value.filter((_, i) => i !== index))}
          conflicts={(next) =>
            value.some((p, i) => i !== index && p.toLowerCase() === next.toLowerCase())
          }
        />
      ))}
      <div className="flex gap-2">
        <Input
          value={adding}
          maxLength={maxLength}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            } else if (event.key === 'Escape') {
              setAdding('')
            }
          }}
          placeholder={placeholder ?? 'add a phrase'}
          className="w-44"
        />
        <Button type="button" variant="outline" disabled={!adding.trim()} onClick={add}>
          <HugeiconsIcon icon={PlusSignIcon} size={14} />
          Add
        </Button>
      </div>
    </div>
  )
}

function PhraseChip({
  phrase,
  maxLength,
  onRename,
  onDelete,
  conflicts
}: {
  phrase: string
  maxLength: number
  onRename: (next: string) => void
  onDelete: () => void
  conflicts: (next: string) => boolean
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)

  if (editing !== null) {
    const draft = editing.trim()
    const invalid = draft === '' || (draft !== phrase && conflicts(draft))
    const commit = (): void => {
      if (invalid) return
      onRename(draft)
      setEditing(null)
    }
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={editing}
          maxLength={maxLength}
          onChange={(event) => setEditing(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              setEditing(null)
            }
          }}
          className="w-44"
        />
        <Button type="button" size="sm" disabled={invalid} onClick={commit}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <span className="group/chip inline-flex h-7 items-center rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground transition-[padding] duration-200 focus-within:pr-1 hover:pr-1">
      {phrase}
      {/* 0fr -> 1fr animates the reveal to content width; plain width can't transition to auto */}
      <span className="grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-200 group-focus-within/chip:grid-cols-[1fr] group-focus-within/chip:opacity-100 group-hover/chip:grid-cols-[1fr] group-hover/chip:opacity-100">
        <span className="flex min-w-0 items-center overflow-hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-1.5"
            aria-label={`Edit phrase ${phrase}`}
            onClick={() => setEditing(phrase)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={10} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete phrase ${phrase}`}
            onClick={onDelete}
          >
            <HugeiconsIcon icon={Delete02Icon} size={10} />
          </Button>
        </span>
      </span>
    </span>
  )
}
