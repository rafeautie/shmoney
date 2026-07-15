import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { LLM_MODEL } from '@shared/llm'
import { cn, plural } from '@/lib/utils'
import { useSuggestionsUi } from '@/lib/suggestions-ui'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useLlmStatus } from '@/lib/llm'
import { useNotifications, type Notification } from '@/lib/notifications'
import { useNotify, useNotifyStore, type Message } from '@/lib/notify-store'

type CircleState = 'active' | 'error' | 'unseen' | 'idle'

const CIRCUMFERENCE = 2 * Math.PI * 6

const arcBaseProps = {
  cx: '8',
  cy: '8',
  r: '6',
  strokeWidth: '2',
  strokeLinecap: 'round' as const,
  transform: 'rotate(-90 8 8)',
  strokeDasharray: CIRCUMFERENCE
}

/**
 * Fixed placeholder arc for a running job with no measurable progress yet: a
 * constant quarter-circle segment that the parent spins. Fades in when a job
 * starts, but snaps out (transition-none) so the handoff to the real progress
 * arc is an instant swap — never a cross-fade, which would read as the fill
 * lurching from this 25% placeholder down to the first (usually smaller) percent.
 */
function IndeterminateArc({ visible }: { visible: boolean }) {
  return (
    <circle
      {...arcBaseProps}
      strokeDashoffset={CIRCUMFERENCE * 0.75}
      className={cn(
        'stroke-primary duration-500 ease-out',
        visible ? 'opacity-100 transition-opacity' : 'opacity-0 transition-none'
      )}
    />
  )
}

/**
 * The measured progress arc. It snaps straight to the real percent the render it
 * first appears — the handoff from the indeterminate placeholder — so the fill
 * never animates in from empty (which, paired with the placeholder fading out,
 * looked like the progress running backward). After that first frame, growth
 * between updates eases, and on hide the offset snaps to empty under the opacity
 * fade so finishing doesn't visibly unwind the progress back down to zero.
 */
/* eslint-disable react-hooks/refs -- previous-value ref: `appearing` must stay true
   for exactly the first committed frame after visible flips on (see comment above);
   mirroring it into state would re-render and drop the transition-none frame */
function ProgressArc({ visible, percent }: { visible: boolean; percent: number }) {
  const offset = visible ? CIRCUMFERENCE * (1 - percent / 100) : CIRCUMFERENCE
  const wasVisible = useRef(visible)
  const appearing = visible && !wasVisible.current
  useEffect(() => {
    wasVisible.current = visible
  }, [visible])
  return (
    <circle
      {...arcBaseProps}
      strokeDashoffset={offset}
      className={cn(
        'stroke-primary duration-500 ease-out',
        !visible
          ? 'opacity-0 transition-opacity'
          : appearing
            ? 'opacity-100 transition-none'
            : 'opacity-100 transition-[stroke-dashoffset,opacity]'
      )}
    />
  )
}
/* eslint-enable react-hooks/refs */

/**
 * The navbar entry point: a small circle that is always visible. A running job
 * draws a progress ring that winds in and out; the base ring morphs blue when
 * unread messages wait, red on an error, and back to gray when idle. Every
 * change is eased, so the states cross-fade into each other rather than snap.
 */
function StatusCircle({
  state,
  percent,
  indeterminate
}: {
  state: CircleState
  percent: number
  indeterminate: boolean
}) {
  const active = state === 'active'
  const attention = state === 'unseen' || state === 'error'
  const ringClass =
    state === 'unseen'
      ? 'stroke-blue-500'
      : state === 'error'
        ? 'stroke-destructive'
        : active
          ? 'stroke-muted-foreground/25'
          : 'stroke-muted-foreground/60'
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn(
        // overflow-visible so the unseen state's drop-shadow glow can bloom past
        // the viewBox instead of being clipped square by the svg's default clip
        'size-5 shrink-0 overflow-visible',
        active && indeterminate && 'animate-spin',
        // a gentle pop once the ring has recolored (delay-150 below), rather
        // than popping at the exact instant everything else starts moving
        attention && 'animate-in zoom-in-90 duration-300 delay-150'
      )}
    >
      <circle
        cx="8"
        cy="8"
        r="5"
        strokeWidth="2"
        // the arc moves first (see below); the ring's recolor trails slightly so
        // the two reads as a short sequence instead of everything landing at once
        className={cn('transition-colors duration-500 ease-out delay-100', ringClass)}
      />
      {/* Dedicated glow layer for the completed (unseen) state: a blue ring that
          coincides with the base ring and carries the drop-shadow. We fade its
          opacity in/out rather than transitioning the filter — Chromium
          interpolates drop-shadow discretely, so animating the filter itself just
          pops. Fading opacity carries the shadow with it. (overflow-visible on the
          svg lets the glow bloom past the viewBox.) */}
      <circle
        cx="8"
        cy="8"
        r="5"
        strokeWidth="2"
        className={cn(
          'stroke-blue-500 filter-[drop-shadow(0_0_4px_var(--color-blue-500))] transition-opacity duration-500 ease-out delay-100',
          state === 'unseen' ? 'opacity-100' : 'opacity-0'
        )}
      />
      <IndeterminateArc visible={active && indeterminate} />
      <ProgressArc visible={active && !indeterminate} percent={percent} />
    </svg>
  )
}

/** An in-flight background job: live progress and a Cancel button. */
function JobItem({ job }: { job: Notification }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{job.title}</p>
      <Progress
        value={job.percent ?? undefined}
        className={cn(job.percent === null && 'animate-pulse')}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {job.canceling ? 'Cancelling…' : job.detail}
        </p>
        <Button variant="outline" size="default" disabled={job.canceling} onClick={job.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** A completed one-shot message, optionally with its follow-up action. */
function MessageItem({ message, onAction }: { message: Message; onAction: () => void }) {
  const isError = message.variant === 'error'
  return (
    <div className="flex items-start gap-2">
      <HugeiconsIcon
        icon={isError ? Alert02Icon : CheckmarkCircle02Icon}
        strokeWidth={2}
        className={cn('mt-0.5 size-4 shrink-0', isError ? 'text-destructive' : 'text-emerald-500')}
      />
      <div className="flex-1 space-y-1">
        <p className={cn('text-sm font-medium', isError && 'text-destructive')}>{message.title}</p>
        {message.description && (
          <p className="text-xs text-muted-foreground">{message.description}</p>
        )}
      </div>
      {message.action && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            message.action?.onClick()
            onAction()
          }}
        >
          {message.action.label}
        </Button>
      )}
    </div>
  )
}

function NotificationPanel({
  jobs,
  messages,
  onAction
}: {
  jobs: Notification[]
  messages: Message[]
  onAction: () => void
}) {
  const empty = jobs.length === 0 && messages.length === 0
  return (
    <div className="flex flex-col">
      <div className="border-b px-4 py-2.5">
        <p className="text-sm font-medium">Notifications</p>
      </div>
      {empty ? (
        <Empty className="gap-2 px-4 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} />
            </EmptyMedia>
            <EmptyDescription>{"You're all caught up."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea viewPortClassName="max-h-96">
          <div className="divide-y">
            {jobs.length > 0 && (
              <div className="space-y-3 p-4">
                {jobs.map((job) => (
                  <JobItem key={job.id} job={job} />
                ))}
              </div>
            )}
            {messages.length > 0 && (
              <div className="space-y-3 p-4">
                {messages.map((message) => (
                  <MessageItem key={message.id} message={message} onAction={onAction} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

/** Fires a completion message when a model download finishes, so the circle
 * turns green for it (the download itself surfaces no message otherwise). */
function useDownloadCompleteNotice() {
  const stage = useLlmStatus().data?.stage
  const notify = useNotify()
  const prev = useRef(stage)
  useEffect(() => {
    if (prev.current === 'downloading' && (stage === 'downloaded' || stage === 'ready')) {
      notify(`${LLM_MODEL.label} ready`, { description: 'Download complete.' })
    }
    prev.current = stage
  }, [stage, notify])
}

/** Surfaces new rule suggestions: a message whose action opens the suggestions
 * dialog on the settings page. The durable copy lives in the settings card. */
function useRuleSuggestionNotice() {
  const notify = useNotify()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setOpen } = useSuggestionsUi()
  useEffect(() => {
    return window.api.ruleSuggestions.onCreated(({ count }) => {
      void queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
      notify(count === 1 ? 'New rule suggestion' : `${count} rule suggestions`, {
        description: 'Turn repeated categorizing into a rule.',
        action: {
          label: 'Review',
          onClick: () => {
            void navigate({ to: '/settings' })
            setOpen(true)
          }
        }
      })
    })
  }, [notify, navigate, queryClient, setOpen])
}

/**
 * Header notification center. An always-visible entry point at the left of the
 * app header, right of the sidebar toggle, that summarises in-flight jobs and
 * recent messages; opening it marks
 * messages seen (clearing the badge), closing it drops the ones already seen.
 */
export function NotificationCenter() {
  useDownloadCompleteNotice()
  useRuleSuggestionNotice()
  const jobs = useNotifications()
  const { messages, markAllSeen, pruneSeen } = useNotifyStore()
  const [open, setOpen] = useState(false)

  // while the panel is open, anything that arrives is read on sight
  useEffect(() => {
    if (open) markAllSeen()
  }, [open, messages, markAllSeen])

  const unseen = messages.filter((m) => !m.seen)
  const count = unseen.length
  const active = jobs.length > 0

  // aggregate ring = average of the jobs reporting a measurable percent; if none
  // do yet, it spins on the indeterminate flag
  const measured = jobs.filter((j) => j.percent !== null)
  const percent = measured.length
    ? measured.reduce((sum, j) => sum + (j.percent as number), 0) / measured.length
    : 0
  const indeterminate = jobs.some((j) => j.percent === null)

  const state: CircleState = active
    ? 'active'
    : unseen.some((m) => m.variant === 'error')
      ? 'error'
      : count > 0
        ? 'unseen'
        : 'idle'

  const label = active
    ? `${plural(jobs.length, 'background task')} running`
    : count > 0
      ? plural(count, 'unread notification')
      : 'Notifications'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) markAllSeen()
        else pruneSeen()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className="rounded-full [-webkit-app-region:no-drag]"
        >
          <StatusCircle state={state} percent={percent} indeterminate={indeterminate} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <NotificationPanel jobs={jobs} messages={messages} onAction={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
