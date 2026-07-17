import { useState } from 'react'
import { Link, useMatchRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon
} from '@hugeicons/core-free-icons'
import type { Conversation } from '@shared/chat'
import { useConversations, useDeleteConversation, useRenameConversation } from '@/lib/chat'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'

/** The Chat sidebar section: a New chat entry above the conversation history. */
export function NavChat() {
  const matchRoute = useMatchRoute()
  const onChat = !!matchRoute({ to: '/chat', fuzzy: false })
  const search = useSearch({ strict: false }) as { c?: number }
  const activeId = onChat ? (search.c ?? null) : null
  // undefined while loading: show nothing rather than a flash of "no chats"
  const conversations = useConversations().data

  return (
    <Collapsible defaultOpen>
      <SidebarGroup>
        <SidebarGroupLabel
          render={<CollapsibleTrigger />}
          className="group/chat-section w-full cursor-pointer pe-14 hover:text-sidebar-foreground"
        >
          Chat
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            className="absolute right-2 transition-transform group-data-panel-open/chat-section:rotate-90"
          />
        </SidebarGroupLabel>
        <SidebarGroupAction
          render={<Link to="/chat" />}
          aria-label="New chat"
          // fade with the group label instead of the built-in instant hidden
          className="right-8 top-2.5 text-sidebar-foreground/70 transition-[opacity,background-color,color] duration-200 ease-in-out group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:opacity-0"
        >
          <HugeiconsIcon icon={Add01Icon} size={16} />
        </SidebarGroupAction>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
          {conversations?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
              No chats yet
            </p>
          )}
          {conversations !== undefined && conversations.length > 0 && (
            <SidebarMenu className="group-data-[collapsible=icon]:hidden">
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                />
              ))}
            </SidebarMenu>
          )}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

function ConversationRow({
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
      >
        <span>{conversation.title ?? 'Untitled'}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover aria-label="Conversation actions" />}
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
