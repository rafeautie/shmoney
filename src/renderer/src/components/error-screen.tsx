import { useState, type ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, FileNotFoundIcon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { errorMessage } from '@/lib/errors'

export function CopyDiagnosticsButton() {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  async function copy() {
    setState('copying')
    try {
      await window.api.diagnostics.copy(await window.api.diagnostics.get())
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <Button variant="outline" disabled={state === 'copying'} onClick={() => void copy()}>
      {state === 'copied'
        ? 'Copied'
        : state === 'failed'
          ? 'Copy failed, try again'
          : 'Copy diagnostics'}
    </Button>
  )
}

/**
 * Shown in place of a page that crashed while rendering. `fullWindow` is for
 * crashes in the app shell itself, where there is no sidebar to navigate with.
 */
export function ErrorScreen({ error, fullWindow }: { error: unknown; fullWindow?: boolean }) {
  return (
    <Empty className={fullWindow ? 'h-svh' : 'h-full'}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Alert02Icon} />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          {fullWindow
            ? 'shmoney hit an unexpected error. Your data is safe. Reload to try again.'
            : 'This page hit an unexpected error. Your data is safe. Reload to try again, or pick another page from the sidebar.'}
        </EmptyDescription>
        <EmptyDescription className="mt-2 line-clamp-3 font-mono break-all select-text">
          {errorMessage(error)}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <CopyDiagnosticsButton />
      </EmptyContent>
      {fullWindow && (
        <EmptyDescription>
          If reloading does not help, copy the diagnostics and include them in a bug report.
        </EmptyDescription>
      )}
    </Empty>
  )
}

export function NotFoundScreen({
  title,
  description,
  backTo,
  backLabel
}: {
  title: string
  description: ReactNode
  backTo: LinkProps['to']
  backLabel: string
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={FileNotFoundIcon} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <Link to={backTo} className={buttonVariants()}>
        {backLabel}
      </Link>
    </Empty>
  )
}
