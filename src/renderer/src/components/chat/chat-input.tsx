import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp02Icon, Loading03Icon, StopIcon } from '@hugeicons/core-free-icons'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'

export function ChatInput({
  hasConversation,
  streaming,
  loading,
  disabled,
  disabledHint,
  onSend,
  onStop
}: {
  /** whether the composer belongs to an existing conversation */
  hasConversation: boolean
  /** a reply is being generated: input stays open, the button becomes Stop */
  streaming: boolean
  /** the model is loading into memory */
  loading: boolean
  /** input unavailable (categorize running, send in flight, …) */
  disabled: boolean
  disabledHint?: string
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const refocusAfterSend = useRef(false)
  const canSend = !disabled && !streaming && text.trim().length > 0

  useEffect(() => {
    if (!refocusAfterSend.current || disabled) return
    refocusAfterSend.current = false
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [disabled, streaming])

  const send = () => {
    if (!canSend) return
    refocusAfterSend.current = true
    onSend(text.trim())
    setText('')
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4 pt-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <InputGroup className="rounded-2xl hover:border-ring/60 has-data-[align=block-end]:rounded-2xl has-[textarea]:rounded-2xl overflow-hidden">
          {/* the textarea grows with its content (field-sizing); the scroll
              area viewport caps the height and owns the scrolling */}
          <ScrollArea
            className="w-full"
            viewPortClassName="max-h-40"
            viewportRef={viewportRef}
            viewportProps={{ tabIndex: -1 }}
          >
            <InputGroupTextarea
              ref={textareaRef}
              placeholder={
                disabled
                  ? (disabledHint ?? 'Chat is unavailable')
                  : loading
                    ? 'Loading the model…'
                    : hasConversation
                      ? 'Write a message...'
                      : 'How can I help you?'
              }
              className="min-h-11 p-4 pb-0"
              value={text}
              disabled={disabled}
              onChange={(e) => {
                setText(e.target.value)
                // the textarea never scrolls itself, so follow the caret when
                // typing at the end pushes it past the viewport
                if (e.target.selectionStart === e.target.value.length) {
                  requestAnimationFrame(() => {
                    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
                  })
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send()
                }
              }}
            />
          </ScrollArea>
          <InputGroupAddon align="block-end" className="p-2">
            {loading && !streaming && (
              <HugeiconsIcon
                icon={Loading03Icon}
                strokeWidth={2}
                role="status"
                aria-label="Loading the model"
                className="ml-1 size-4 animate-spin text-muted-foreground"
              />
            )}
            <InputGroupButton
              variant="default"
              size="icon-sm"
              type="submit"
              disabled={!canSend}
              className="ml-auto rounded-lg data-[hidden=true]:hidden"
              data-hidden={streaming}
            >
              <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
              <span className="sr-only">Send</span>
            </InputGroupButton>
            <InputGroupButton
              size="icon-sm"
              type="button"
              data-hidden={!streaming}
              className="ml-auto rounded-lg data-[hidden=true]:hidden"
              onClick={onStop}
            >
              <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}

/** Shown in the composer's place when the conversation is read-only. */
export function ChatInputNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl p-4 pt-2">
      <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        {children}
      </p>
    </div>
  )
}
