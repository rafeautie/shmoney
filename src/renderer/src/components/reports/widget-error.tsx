import { Component, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { errorMessage, logRenderError } from '@/lib/errors'

export function WidgetError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = errorMessage(error)
  return (
    <Empty className="h-full gap-2 p-4">
      <HugeiconsIcon icon={Alert02Icon} className="size-4 text-muted-foreground" />
      <EmptyTitle>This widget could not load</EmptyTitle>
      <EmptyDescription className="line-clamp-2 break-all select-text" title={message}>
        {message}
      </EmptyDescription>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Empty>
  )
}

/** Keeps a widget that throws while rendering from taking the whole report down. */
export class WidgetErrorBoundary extends Component<
  // a new resetKey (an edited config) clears a caught error
  { children: ReactNode; resetKey: unknown },
  { error: unknown; failed: boolean }
> {
  state = { error: null as unknown, failed: false }

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown) {
    logRenderError('widget-render-error', error)
  }

  componentDidUpdate(prev: { resetKey: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, failed: false })
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <WidgetError
          error={this.state.error}
          onRetry={() => this.setState({ error: null, failed: false })}
        />
      )
    }
    return this.props.children
  }
}
