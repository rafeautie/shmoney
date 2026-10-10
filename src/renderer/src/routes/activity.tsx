import { Fragment, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Clock01Icon, SearchRemoveIcon } from '@hugeicons/core-free-icons'
import { ACTION_SOURCES, type ActionRun, type ActionSource } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import { cn } from '@/lib/utils'
import { activityOptions } from '@/lib/queries'
import { SETTINGS_QUERY_KEY, useSettings } from '@/lib/settings'
import { useMarkActivitySeen, useRuleSuggestions } from '@/lib/activity-seen'
import { buildFeed, SOURCE_LABELS } from '@/lib/activity-feed'
import { Page } from '@/components/page'
import { EntryRow } from '@/components/activity/entry-row'
import { RunCard } from '@/components/activity/run-card'
import { SuggestionsQueue } from '@/components/activity/suggestions-queue'
import { SourceIcon } from '@/components/activity/source-icon'
import { FilterSearchInput } from '@/components/transactions/filter-search-input'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/activity')({
  loader: ({ context }) => {
    const settings = context.queryClient.getQueryData<Settings>(SETTINGS_QUERY_KEY)
    return context.queryClient.ensureInfiniteQueryData(
      activityOptions({ source: settings?.activitySource ?? null, q: '' })
    )
  },
  component: ActivityPage
})

function DayHeading({ date }: { date: Date }) {
  const relative = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : null
  return (
    <h3 className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
      {relative ?? format(date, 'EEEE, MMM d, yyyy')}
      {relative && (
        <span className="text-xs font-normal text-muted-foreground">
          {format(date, 'EEEE, MMM d')}
        </span>
      )}
    </h3>
  )
}

function FilterChip({
  pressed,
  onClick,
  children
}: {
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant={pressed ? 'default' : 'outline'}
      aria-pressed={pressed}
      className="gap-1.5 rounded-full font-normal [&_svg:not([class*='size-'])]:size-[13px]"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function ActivityPage() {
  const { settings, setSetting } = useSettings()
  const source = settings.activitySource
  const [q, setQ] = useState('')
  const filtered = source !== null || q !== ''

  useMarkActivitySeen()

  const query = useInfiniteQuery({
    ...activityOptions({ source, q }),
    placeholderData: keepPreviousData
  })
  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.entries) ?? [], [query.data])
  const runs = useMemo(
    () =>
      Object.assign({}, ...(query.data?.pages.map((p) => p.runs) ?? [])) as Record<
        number,
        ActionRun
      >,
    [query.data]
  )
  const days = useMemo(() => buildFeed(entries, runs, !filtered), [entries, runs, filtered])

  const suggestions = useRuleSuggestions().data ?? []

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => window.api.categories.list()
  })
  const categoryName = useMemo(() => {
    const map = new Map<number, string>()
    const data = categoriesQuery.data
    if (data) {
      for (const group of data.groups) for (const c of group.categories) map.set(c.id, c.name)
      for (const c of [...data.ungrouped, ...data.system]) map.set(c.id, c.name)
    }
    return map
  }, [categoriesQuery.data])

  const setSource = (next: ActionSource | null) => setSetting('activitySource', next)
  const clearFilters = () => {
    setSource(null)
    setQ('')
  }

  return (
    <Page className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Activity</h2>
        <p className="text-muted-foreground">
          Every change to your money, by you or by shmoney. Undo anything.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip pressed={source === null} onClick={() => setSource(null)}>
          All
        </FilterChip>
        {ACTION_SOURCES.map((s, i) => (
          <Fragment key={s}>
            {/* the user's own changes first, then everything shmoney did */}
            {i === 1 && <span className="mx-0.5 h-[18px] w-px bg-border" />}
            <FilterChip pressed={source === s} onClick={() => setSource(s)}>
              <SourceIcon source={s} size={13} />
              {SOURCE_LABELS[s]}
            </FilterChip>
          </Fragment>
        ))}
        <div className="ml-auto">
          <FilterSearchInput
            value={q || undefined}
            onChange={(v) => setQ(v ?? '')}
            placeholder="Search activity..."
          />
        </div>
      </div>

      {!filtered && suggestions.length > 0 && <SuggestionsQueue suggestions={suggestions} />}

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : days.length === 0 ? (
        filtered ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={SearchRemoveIcon} />
              </EmptyMedia>
              <EmptyTitle>Nothing matches</EmptyTitle>
              <EmptyDescription>No activity fits this filter.</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </Empty>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Clock01Icon} />
              </EmptyMedia>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>
                Categorizing, deleting, or marking transfers shows up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <div className={cn('space-y-8', query.isPlaceholderData && 'opacity-60')}>
          {days.map((day) => (
            <div key={day.date.toDateString()} className="space-y-2">
              <DayHeading date={day.date} />
              <div className="divide-y overflow-hidden rounded-lg border">
                {day.items.map((item) =>
                  item.kind === 'run' ? (
                    <RunCard
                      key={`run:${item.run.id}`}
                      run={item.run}
                      entries={item.entries}
                      categoryName={categoryName}
                    />
                  ) : (
                    <EntryRow key={item.entry.id} entry={item.entry} categoryName={categoryName} />
                  )
                )}
              </div>
            </div>
          ))}
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Loading...' : 'Load older activity'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Page>
  )
}
