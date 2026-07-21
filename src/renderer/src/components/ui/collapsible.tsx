'use client'

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

import { cn } from '@/lib/utils'

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      // the global `* { transition-colors duration-[250ms] }` rule makes Base UI
      // read the panel as animated and delay unmount by several frames — a
      // visible flash on close. Zero the duration so an unanimated panel closes
      // synchronously; a caller's own transition classes still win the merge.
      className={cn('transition-none duration-0', className)}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
