import type { ReactNode } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

/** Standard scrolling page body. Routes that manage their own scrolling (e.g. full-bleed tables) skip this. */
export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn('p-6', className)}>{children}</div>
    </ScrollArea>
  )
}
