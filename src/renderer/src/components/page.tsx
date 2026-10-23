import type { ReactNode } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

/** Standard scrolling page body. Routes that manage their own scrolling (e.g. full-bleed tables) skip this. */
export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn('p-page', className)}>{children}</div>
    </ScrollArea>
  )
}

/**
 * Every page's title row: its name and a one-line description, with the page's
 * buttons on the right. In a narrow window the buttons drop to their own row
 * instead of squeezing the description into a thin column.
 */
export function PageHeader({
  title,
  description,
  children
}: {
  title: ReactNode
  description?: ReactNode
  /** the page's buttons */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
