import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp02Icon, StopCircleIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'

export function ChatInput({
  streaming,
  disabled,
  disabledHint,
  onSend,
  onStop
}: {
  /** a reply is being generated: input stays open, the button becomes Stop */
  streaming: boolean
  /** input unavailable (model not ready, categorize running, …) */
  disabled: boolean
  disabledHint?: string
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const canSend = !disabled && !streaming && text.trim().length > 0

  const send = () => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 pt-2">
      <InputGroup className="h-auto items-end">
        <textarea
          data-slot="input-group-control"
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? (disabledHint ?? 'Chat is unavailable') : 'Ask anything…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-xs/relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
        <InputGroupAddon align="inline-end" className="py-1">
          {streaming ? (
            <Button variant="ghost" size="icon-xs" aria-label="Stop generating" onClick={onStop}>
              <HugeiconsIcon icon={StopCircleIcon} size={16} />
            </Button>
          ) : (
            <Button size="icon-xs" aria-label="Send message" disabled={!canSend} onClick={send}>
              <HugeiconsIcon icon={ArrowUp02Icon} size={16} />
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
