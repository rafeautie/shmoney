import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { LLM_MODEL } from '@shared/llm'
import { cn, plural } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useLlmStatus } from '@/lib/llm'
import { useNotifications, type Notification } from '@/lib/notifications'
import { useNotify, useNotifyStore, type Message } from '@/lib/notify-store'

type CircleState = 'active' | 'error' | 'unseen' | 'idle'

/**
 * The navbar entry point: a small circle that is always visible. It shows a
 * progress ring while a job runs, turns green (red for errors) when unseen
 * messages are waiting, and is gray when idle.
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
  const circumference = 2 * Math.PI * 6
  const trackClass =
    state === 'active'
      ? 'stroke-muted-foreground/25'
      : state === 'error'
        ? 'stroke-destructive'
        : 'stroke-muted-foreground/60'
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={cn('size-5', state === 'active' && indeterminate && 'animate-spin')}
      >
        {state === 'unseen' ? (
          <circle cx="8" cy="8" r="6" strokeWidth="2" className="stroke-blue-500" />
        ) : (
          <circle cx="8" cy="8" r="5" strokeWidth="2" className={trackClass} />
        )}
        {state === 'active' && (
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
        )}
      </svg>
    </span>
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
        <Button variant="outline" size="sm" disabled={job.canceling} onClick={job.cancel}>
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
          size="xs"
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
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {"You're all caught up."}
        </p>
      ) : (
        <ScrollArea className="max-h-96">
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

/**
 * Header notification center. An always-visible entry point centered in the app
 * header that summarises in-flight jobs and recent messages; opening it marks
 * messages seen (clearing the badge), closing it drops the ones already seen.
 */
export function NotificationCenter() {
  useDownloadCompleteNotice()
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
      <PopoverContent align="center" className="w-80 p-0">
        <NotificationPanel jobs={jobs} messages={messages} onAction={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
