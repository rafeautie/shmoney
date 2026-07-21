import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, MoreHorizontalIcon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import type { Conversation } from '@shared/chat'
import { useDeleteConversation, useRenameConversation } from '@/lib/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

/** One conversation in the sidebar history: link, inline rename, delete menu. */
export function ConversationRow({
  conversation,
  active
}: {
  conversation: Conversation
  active: boolean
}) {
  const navigate = useNavigate()
  const rename = useRenameConversation()
  const deleteConversation = useDeleteConversation()
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
      <SidebarMenuItem>
        <Input
          autoFocus
          className="h-8 px-2 text-xs"
          defaultValue={conversation.title ?? ''}
          onBlur={(e) => commitRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(e.currentTarget.value)
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to="/chat" search={{ c: conversation.id }} />}
        isActive={active}
        // hover on the whole row (including the three-dots action) keeps the
        // button's hover look, so it doesn't flicker off under the action
        className="group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
      >
        <span>{conversation.title ?? 'Untitled'}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              aria-label="Conversation actions"
              // fade in on row hover with the same gentle timing as button hovers
              className="transition-[opacity,transform,background-color,color] ease-in-out"
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              deleteConversation.mutate(conversation.id)
              if (active) void navigate({ to: '/chat' })
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
