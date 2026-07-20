import { Link, useMatchRoute, useSearch } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { useConversations } from '@/lib/chat'
import { ConversationRow } from '@/components/chat/conversation-row'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu
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
    <Collapsible defaultOpen className="flex min-h-0 flex-col">
      <SidebarGroup className="min-h-0">
        <SidebarGroupLabel
          render={<CollapsibleTrigger />}
          className="group/chat-section w-full cursor-pointer pe-14 hover:text-sidebar-foreground group-data-[collapsible=icon]:pointer-events-none"
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
        <CollapsibleContent className="flex h-(--collapsible-panel-height) min-h-0 flex-col overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
          {conversations?.length === 0 && (
            // Pinned to the expanded width (the sidebar less the group's px-2
            // and this box's mx-2) rather than the base w-full: the text keeps
            // its lines instead of reflowing as the sidebar narrows, and the
            // group clips the overflow while it fades out on the same timing as
            // the New chat action above.
            <Empty className="mx-2 mt-3 w-[calc(var(--sidebar-width)-2rem)] gap-2 border px-2 py-4 transition-opacity duration-200 ease-in-out group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
              <EmptyHeader>
                <EmptyDescription>
                  No chats yet. Start one to ask about your money.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {conversations !== undefined && conversations.length > 0 && (
            <SidebarMenu className="no-scrollbar scroll-fade-y min-h-0 overflow-y-auto group-data-[collapsible=icon]:hidden">
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
