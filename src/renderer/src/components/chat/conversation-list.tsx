import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon
} from '@hugeicons/core-free-icons'
import type { Conversation } from '@shared/chat'
import { cn } from '@/lib/utils'
import { useConversations, useDeleteConversation, useRenameConversation } from '@/lib/chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export function ConversationList({
  activeId,
  onSelect
}: {
  activeId: number | null
  onSelect: (id: number | null) => void
}) {
  const conversations = useConversations().data ?? []
  const deleteConversation = useDeleteConversation()

  return (
    <div className="flex w-56 shrink-0 flex-col border-r">
      <div className="p-2">
        <Button variant="outline" className="w-full justify-start" onClick={() => onSelect(null)}>
          <HugeiconsIcon icon={Add01Icon} size={14} />
          New chat
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2 pt-0">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onSelect={() => onSelect(conversation.id)}
              onDelete={() => {
                deleteConversation.mutate(conversation.id)
                if (conversation.id === activeId) onSelect(null)
              }}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete
}: {
  conversation: Conversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const rename = useRenameConversation()
  const [editing, setEditing] = useState(false)

  const commitRename = (title: string) => {
    setEditing(false)
    const trimmed = title.trim()
    if (trimmed && trimmed !== conversation.title) {
      rename.mutate({ id: conversation.id, title: trimmed })
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={conversation.title ?? ''}
        onBlur={(e) => commitRename(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename(e.currentTarget.value)
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <div
      className={cn(
        'group/conversation flex h-7 items-center rounded-md text-xs hover:bg-muted',
        active && 'bg-muted'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate px-2 py-1.5 text-left outline-none"
      >
        {conversation.title ?? 'Untitled'}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="mr-1 opacity-0 group-hover/conversation:opacity-100 aria-expanded:opacity-100"
              aria-label="Conversation actions"
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
