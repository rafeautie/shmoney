import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { cn, plural } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useNotifications, type Notification } from '@/lib/notifications'

/**
 * Small SVG ring that fills to `percent`. When `indeterminate` (a job is running
 * but has no measurable progress yet) it shows a fixed arc and spins instead.
 */
function LoadingRing({ percent, indeterminate }: { percent: number; indeterminate: boolean }) {
  const circumference = 2 * Math.PI * 6
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('size-4', indeterminate && 'animate-spin')}>
      <circle cx="8" cy="8" r="6" strokeWidth="2" className="stroke-muted-foreground/25" />
      <circle
        cx="8"
        cy="8"
        r="6"
        strokeWidth="2"
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        className="stroke-primary transition-[stroke-dashoffset]"
        strokeDasharray={circumference}
        strokeDashoffset={
          indeterminate ? circumference * 0.75 : circumference * (1 - percent / 100)
        }
      />
    </svg>
  )
}

function NotificationItem({ item }: { item: Notification }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{item.title}</p>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={item.canceling}
          onClick={item.cancel}
          title="Cancel"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          <span className="sr-only">Cancel</span>
        </Button>
      </div>
      <Progress
        value={item.percent ?? undefined}
        className={cn(item.percent === null && 'animate-pulse')}
      />
      <p className="text-xs text-muted-foreground">
        {item.canceling ? 'Cancelling…' : item.detail}
      </p>
    </div>
  )
}

/**
 * Navbar notification center: a loading ring summarising every in-flight
 * background job, that reveals the per-job progress and cancel controls on hover.
 * Renders nothing when nothing is running.
 */
export function NotificationCenter() {
  const notifications = useNotifications()
  if (notifications.length === 0) return null

  // aggregate ring = average of the jobs that report a measurable percent; if none
  // do yet, the ring is empty and spins on the indeterminate flag below
  const measured = notifications.filter((n) => n.percent !== null)
  const percent = measured.length
    ? measured.reduce((sum, n) => sum + (n.percent as number), 0) / measured.length
    : 0
  const indeterminate = notifications.some((n) => n.percent === null)

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="[-webkit-app-region:no-drag]"
          aria-label={`${plural(notifications.length, 'background task')} running`}
        >
          <LoadingRing percent={percent} indeterminate={indeterminate} />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Activity</p>
        {notifications.map((item) => (
          <NotificationItem key={item.id} item={item} />
        ))}
      </HoverCardContent>
    </HoverCard>
  )
}
