import { memo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon, MoreHorizontalIcon, PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { conversationStatus, type Conversation } from '@shared/chat'
import { useDeleteConversation, useRenameConversation } from '@/lib/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { NameDialog } from '@/components/name-dialog'
import { StatusDot } from '@/components/layout/nav-dot'
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

/** One conversation in the sidebar history: link, and a menu to rename or delete it. */
export const ConversationRow = memo(function ConversationRow({
  conversation,
  active
}: {
  conversation: Conversation
  active: boolean
}) {
  const navigate = useNavigate()
  const rename = useRenameConversation()
  const deleteConversation = useDeleteConversation()
  const [renaming, setRenaming] = useState(false)
  // the dropdown (a Base UI root) mounts on first hover or focus, not for every row up front
  const [armed, setArmed] = useState(false)
  const status = conversationStatus(conversation)
  // the open thread is being read as it lands; only its running reply is news
  const dot = status === 'busy' || (status !== null && !active) ? status : null

  return (
    <SidebarMenuItem onPointerEnter={() => setArmed(true)} onFocus={() => setArmed(true)}>
      <SidebarMenuButton
        render={<Link to="/chat" search={{ c: conversation.id }} />}
        isActive={active}
        // hover on the whole row (including the three-dots action) keeps the
        // button's hover look, so it doesn't flicker off under the action
        className="group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
      >
        <StatusDot
          tone={
            dot === null ? null : dot === 'busy' ? 'busy' : dot === 'failed' ? 'attention' : 'info'
          }
        />
        <span className="truncate">{conversation.title ?? 'Untitled'}</span>
      </SidebarMenuButton>
      {armed && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                aria-label="Conversation actions"
                // fade in on row hover with the same gentle timing as button hovers
                className="transition-[opacity,transform,background-color,color]"
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
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
      )}
      {armed && (
        <NameDialog
          open={renaming}
          onOpenChange={setRenaming}
          title="Rename conversation"
          name={conversation.title ?? ''}
          placeholder="Untitled"
          onSave={(title) => rename.mutateAsync({ id: conversation.id, title })}
        />
      )}
    </SidebarMenuItem>
  )
})
