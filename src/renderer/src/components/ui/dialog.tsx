'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { cn } from '@/lib/utils'
import { useDialogStackPosition, useStackedDialog } from '@/lib/dialog-stack'
import { Button } from '@/components/ui/button'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  stackId,
  ...props
}: DialogPrimitive.Backdrop.Props & { stackId: string }) {
  const { below } = useDialogStackPosition(stackId)
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/80 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        // over another dialog it still owns outside clicks, but draws nothing
        // so the page doesn't darken twice
        below > 0 && 'bg-transparent supports-backdrop-filter:backdrop-blur-none',
        className
      )}
      // base-ui skips this for a dialog nested in another's React tree; keep it
      // so nested and sibling stacks behave the same
      forceRender
      {...props}
    />
  )
}

/** The popup element, holding its place in the dialog stack while open. */
function StackedPopup({
  stackId,
  open,
  style,
  ...props
}: React.ComponentProps<'div'> & { stackId: string; open: boolean }) {
  useStackedDialog(stackId, open)
  const { below, above } = useDialogStackPosition(stackId)
  return (
    <div
      {...props}
      data-stacked={below > 0 ? '' : undefined}
      data-covered={above > 0 ? '' : undefined}
      style={{ ...style, '--covered': above } as React.CSSProperties}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const stackId = React.useId()
  return (
    <DialogPortal>
      <DialogOverlay stackId={stackId} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 [--lifted:var(--popover)] text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          // under another dialog: recede (shift up, shrink, dim behind a scrim)
          // so the stack reads as cards; the dialog on top is lifted by a shadow
          'transition-[scale,translate] after:pointer-events-none after:absolute after:inset-0 after:z-50 after:rounded-[inherit] after:bg-black/40 after:opacity-0 after:transition-opacity after:duration-150 data-stacked:shadow-2xl data-covered:-translate-y-[calc(50%+2rem*var(--covered))] data-covered:scale-[calc(1-0.03*var(--covered))] data-covered:after:opacity-100',
          className
        )}
        render={(popup, state) => <StackedPopup {...popup} stackId={stackId} open={state.open} />}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-1', className)} {...props} />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-sm font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
