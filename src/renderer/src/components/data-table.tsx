import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState
} from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  InboxIcon
} from '@hugeicons/core-free-icons'
import { TABLE_BLEED, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RowExpandedContext } from '@/components/data-table-row-expanded'

// enough placeholder rows to fill the visible area of a typical table
const SKELETON_ROWS = 8

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- params must match the library declaration
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra classes for this column's th and td (e.g. 'w-full max-w-0' for a greedy truncating column) */
    className?: string
  }
  interface TableMeta<TData extends RowData> {
    /**
     * Selects/deselects a row. With `shiftKey`, applies `selected` to every
     * selectable row between the last row toggled and this one.
     */
    toggleRowSelected: (row: Row<TData>, selected: boolean, shiftKey?: boolean) => void
  }
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className
}: {
  column: Column<TData, TValue>
  title: string
  className?: string
}) {
  // `column` keeps its identity while its sort changes, so the compiler would
  // cache a stale icon and click handler
  'use no memo'
  if (!column.getCanSort()) {
    return <div className={className}>{title}</div>
  }
  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-3 h-8', className)}
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {title}
      <HugeiconsIcon
        className="size-3.5"
        icon={
          sorted === 'asc' ? ArrowUp01Icon : sorted === 'desc' ? ArrowDown01Icon : ArrowUpDownIcon
        }
      />
    </Button>
  )
}

interface DataTableRowProps<TData> {
  row: Row<TData>
  // the rest mirror state `row` reads, so the memo comparison can see it change
  selected: boolean
  canSelect: boolean
  columns: ColumnDef<TData, unknown>[]
  className: string
  onClick: ((row: TData) => void) | undefined
}

function DataTableRowImpl<TData>({ row, selected, className, onClick }: DataTableRowProps<TData>) {
  // the compiler would cache the cells on `row` alone, missing selection changes
  'use no memo'
  const [openPopovers, setOpenPopovers] = useState(0)
  const reportExpanded = useCallback((delta: number) => setOpenPopovers((n) => n + delta), [])
  return (
    <RowExpandedContext value={reportExpanded}>
      <TableRow
        expanded={openPopovers > 0}
        data-state={selected ? 'selected' : undefined}
        className={className}
        onClick={onClick ? () => onClick(row.original) : undefined}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    </RowExpandedContext>
  )
}

// Row objects are rebuilt whenever data changes (e.g. a page loads), so compare
// the underlying record instead; the query's structural sharing keeps it stable
const DataTableRow = memo(
  DataTableRowImpl,
  (prev, next) =>
    prev.row.id === next.row.id &&
    prev.row.original === next.row.original &&
    prev.selected === next.selected &&
    prev.canSelect === next.canSelect &&
    prev.columns === next.columns &&
    prev.className === next.className &&
    prev.onClick === next.onClick
) as typeof DataTableRowImpl

/** Runs of consecutive rows sharing a key, each under a sticky header row */
export interface DataTableGroups<TData, TTail = unknown> {
  key: (row: TData) => string
  /** keep stable: a new header re-renders every group */
  header: (key: string, rows: TData[], tail: TTail | undefined) => React.ReactNode
  /** handed only to the trailing group, which may continue on a page not loaded yet */
  tail?: TTail
}

interface GroupRun<TData> {
  /** React key: the group key, suffixed if it repeats */
  id: string
  key: string
  rows: Row<TData>[]
  originals: TData[]
}

function groupRuns<TData>(rows: Row<TData>[], key: (row: TData) => string): GroupRun<TData>[] {
  const runs: GroupRun<TData>[] = []
  const seen = new Map<string, number>()
  for (const row of rows) {
    const k = key(row.original)
    const current = runs.at(-1)
    if (current && current.key === k) {
      current.rows.push(row)
      current.originals.push(row.original)
      continue
    }
    // an optimistic edit can briefly split a key's run; React keys must stay unique
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    runs.push({ id: n === 0 ? k : `${k}#${n}`, key: k, rows: [row], originals: [row.original] })
  }
  return runs
}

interface DataTableGroupProps<TData, TTail> {
  run: GroupRun<TData>
  tail: TTail | undefined
  header: DataTableGroups<TData, TTail>['header']
  columns: ColumnDef<TData, unknown>[]
  /** ids of the group's selected rows, so selecting elsewhere skips this group */
  selected: string
  rowClassName: string | undefined
  rowClass: ((row: TData) => string | false | undefined) | undefined
  onClick: ((row: TData) => void) | undefined
}

function DataTableGroupImpl<TData, TTail>({
  run,
  tail,
  header,
  columns,
  rowClassName,
  rowClass,
  onClick
}: DataTableGroupProps<TData, TTail>) {
  // rows read selection off the table, which the compiler can't see change
  'use no memo'
  return (
    // a bare tbody: TableBody's class merge would run per group, and without its
    // last-row rule each group keeps its closing border
    <tbody data-slot="table-body">
      {/* top-10 parks it under the column header. Sticky rows are bounded by the
          table, not their body, so passed headers pile up under the newest: the
          cell stays opaque. A shadow draws the border, since a collapsed border
          stays behind when the row sticks; the transparent one keeps the row's
          share of the border grid, so later lines land on whole pixels */}
      <TableRow className="sticky top-10 z-[5] border-b-transparent hover:bg-transparent">
        <TableCell
          colSpan={columns.length}
          className="h-8 bg-band py-0 shadow-[inset_0_-1px_0_0_var(--border)] in-data-[slot=card]:bg-tray"
        >
          {header(run.key, run.originals, tail)}
        </TableCell>
      </TableRow>
      {run.rows.map((row) => (
        <DataTableRow
          key={row.id}
          row={row}
          selected={row.getIsSelected()}
          canSelect={row.getCanSelect()}
          columns={columns}
          className={cn(rowClassName, rowClass?.(row.original))}
          onClick={onClick}
        />
      ))}
    </tbody>
  )
}

// runs are regrouped whenever a page lands, so compare the records a run holds
const DataTableGroup = memo(
  DataTableGroupImpl,
  (prev, next) =>
    prev.run.id === next.run.id &&
    prev.run.originals.length === next.run.originals.length &&
    prev.run.originals.every((row, i) => row === next.run.originals[i]) &&
    prev.tail === next.tail &&
    prev.header === next.header &&
    prev.columns === next.columns &&
    prev.selected === next.selected &&
    prev.rowClassName === next.rowClassName &&
    prev.rowClass === next.rowClass &&
    prev.onClick === next.onClick
) as typeof DataTableGroupImpl

interface DataTableProps<TData, TTail> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  /** Called when the end of the table scrolls into view and `hasMore` is set */
  onLoadMore?: () => void
  hasMore?: boolean
  isFetchingMore?: boolean
  isLoading?: boolean
  emptyMessage?: string
  onRowClick?: (row: TData) => void
  /** Pinned row rendered at the top of the body (e.g. an inline entry row) */
  topRow?: React.ReactNode
  /** Extra classes per row, e.g. to dim rows matching a predicate */
  rowClassName?: (row: TData) => string | false | undefined
  /** Row selection is controlled: pass all three (plus getRowId for stable ids across refetches) */
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean)
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  getRowId?: (row: TData) => string
  /** Aligns first/last cell content with p-6 page chrome when the table bleeds to the edges */
  bleed?: boolean
  /** e.g. "min-h-0 flex-1" to fill the parent's height; only the table body scrolls */
  className?: string
  /** Group rows under sticky headers; only meaningful when the sort keeps groups together */
  groups?: DataTableGroups<TData, TTail>
}

export function DataTable<TData, TTail = undefined>({
  columns,
  data,
  sorting,
  onSortingChange,
  onLoadMore,
  hasMore,
  isFetchingMore,
  isLoading,
  emptyMessage = 'No results.',
  onRowClick,
  topRow,
  rowClassName,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  bleed,
  className,
  groups
}: DataTableProps<TData, TTail>) {
  // the row a shift-click extends from: the last one toggled on its own
  const anchorRef = useRef<string | null>(null)

  // hoisted so it can read `table`, which it only ever touches once called
  function toggleRowSelected(row: Row<TData>, selected: boolean, shiftKey = false) {
    const rows = table.getRowModel().rows
    const from =
      shiftKey && anchorRef.current ? rows.findIndex((r) => r.id === anchorRef.current) : -1
    const to = rows.findIndex((r) => r.id === row.id)
    anchorRef.current = row.id
    if (from === -1 || to === -1) {
      row.toggleSelected(selected)
      return
    }
    const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1)
    onRowSelectionChange?.((prev) => {
      const next = { ...prev }
      for (const r of range) {
        if (!r.getCanSelect()) continue
        if (selected) next[r.id] = true
        else delete next[r.id]
      }
      return next
    })
  }

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableRowSelection,
    getRowId,
    state: { sorting, rowSelection: rowSelection ?? {} },
    onSortingChange,
    onRowSelectionChange,
    meta: { toggleRowSelected }
  })

  // rows get one stable click handler, so an inline onRowClick doesn't re-render them all
  const onRowClickRef = useRef(onRowClick)
  useLayoutEffect(() => {
    onRowClickRef.current = onRowClick
  })
  const handleRowClick = useCallback((original: TData) => onRowClickRef.current?.(original), [])

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !onLoadMore || !hasMore || isFetchingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { root: scrollRef.current, rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore, hasMore, isFetchingMore])

  // empty/loading renders a single spanning row; h-full on the table stretches
  // it to fill the viewport instead of collapsing to a fixed 96px box
  const rows = table.getRowModel().rows
  const isEmpty = rows.length === 0
  // the row model keeps its identity across selection and other re-renders
  const groupKey = groups?.key
  const runs = useMemo(() => (groupKey ? groupRuns(rows, groupKey) : []), [rows, groupKey])

  const renderRow = (row: Row<TData>) => (
    <DataTableRow
      key={row.id}
      row={row}
      selected={row.getIsSelected()}
      canSelect={row.getCanSelect()}
      columns={columns}
      className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
      onClick={onRowClick ? handleRowClick : undefined}
    />
  )
  const fetchingMoreRow = isFetchingMore && (
    <TableRow className="hover:bg-transparent">
      {columns.map((_column, column) => (
        <TableCell key={column}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  )

  return (
    // isolate: the sticky header and day rows layer within the viewport, under the scrollbar
    <ScrollArea viewportRef={scrollRef} className={className} viewPortClassName="isolate">
      <table
        className={cn('w-full caption-bottom text-xs', isEmpty && 'h-full', bleed && TABLE_BLEED)}
      >
        {/* box-shadows stand in for the header's borders, which collapse drops while sticky */}
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_1px_0_0_var(--border),inset_0_-1px_0_0_var(--border)] in-data-[slot=card]:bg-card [&_tr]:border-b-0">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        {groups && !isEmpty ? (
          <>
            {topRow && <TableBody className="[&_tr:last-child]:border-b!">{topRow}</TableBody>}
            {runs.map((run, i) => (
              <DataTableGroup
                key={run.id}
                run={run}
                tail={i === runs.length - 1 ? groups.tail : undefined}
                header={groups.header}
                columns={columns}
                selected={run.rows
                  .filter((row) => row.getIsSelected())
                  .map((row) => row.id)
                  .join()}
                rowClassName={onRowClick ? 'cursor-pointer' : undefined}
                rowClass={rowClassName}
                onClick={onRowClick ? handleRowClick : undefined}
              />
            ))}
            {fetchingMoreRow && <TableBody>{fetchingMoreRow}</TableBody>}
          </>
        ) : (
          /* the ! outweighs the base last-row border-0 rule, which shares specificity;
            skip it when empty so the full-height empty state has no closing border */
          <TableBody className={cn(!isEmpty && '[&_tr:last-child]:border-b!')}>
            {topRow}
            {isEmpty && isLoading ? (
              // placeholder rows rather than a centred word, so the table keeps
              // its shape and the real rows drop straight in
              Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <TableRow key={`skeleton-${row}`} className="hover:bg-transparent">
                  {columns.map((_column, column) => (
                    <TableCell key={column}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isEmpty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-full">
                  <Empty className="gap-2 py-2">
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={InboxIcon} />
                    </EmptyMedia>
                    <EmptyDescription>{emptyMessage}</EmptyDescription>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              rows.map(renderRow)
            )}
            {fetchingMoreRow}
          </TableBody>
        )}
      </table>
      {hasMore && <div ref={sentinelRef} className="h-px" />}
    </ScrollArea>
  )
}
