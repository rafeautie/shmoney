import { useEffect, useRef } from 'react'
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- params must match the library declaration
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra classes for this column's th and td (e.g. 'w-full max-w-0' for a greedy truncating column) */
    className?: string
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
        icon={
          sorted === 'asc' ? ArrowUp01Icon : sorted === 'desc' ? ArrowDown01Icon : ArrowUpDownIcon
        }
        size={14}
      />
    </Button>
  )
}

interface DataTableProps<TData> {
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
}

export function DataTable<TData>({
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
  rowClassName,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  bleed,
  className
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableRowSelection,
    getRowId,
    state: { sorting, rowSelection: rowSelection ?? {} },
    onSortingChange,
    onRowSelectionChange
  })

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
  const isEmpty = table.getRowModel().rows.length === 0

  return (
    <ScrollArea viewportRef={scrollRef} className={className}>
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
        {/* the ! outweighs the base last-row border-0 rule, which shares specificity;
            skip it when empty so the full-height empty state has no closing border */}
        <TableBody className={cn(!isEmpty && '[&_tr:last-child]:border-b!')}>
          {isEmpty ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-full">
                {isLoading ? (
                  <div className="text-center text-muted-foreground">Loading…</div>
                ) : (
                  <Empty className="gap-2 py-2">
                    <EmptyMedia variant="icon">
                      <HugeiconsIcon icon={InboxIcon} />
                    </EmptyMedia>
                    <EmptyDescription>{emptyMessage}</EmptyDescription>
                  </Empty>
                )}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
          {isFetchingMore && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-12 text-center text-muted-foreground"
              >
                Loading more…
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </table>
      {hasMore && <div ref={sentinelRef} className="h-px" />}
    </ScrollArea>
  )
}
