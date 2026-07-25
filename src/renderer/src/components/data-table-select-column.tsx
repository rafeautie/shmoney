import type { ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * Checkbox column wired to a DataTable's selection state; put it first in the
 * columns array. Requires DataTable's selection props (enableRowSelection,
 * rowSelection, onRowSelectionChange, getRowId).
 */
export function selectColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: 'select',
    enableSorting: false,
    // the base cell strips right padding next to checkboxes; restore breathing room
    meta: { className: 'pr-4!' },
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && 'indeterminate')}
        onCheckedChange={(value) => table.toggleAllRowsSelected(value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row, table }) =>
      row.getCanSelect() && (
        <Checkbox
          checked={row.getIsSelected()}
          // the click, not onCheckedChange: the change event behind it carries no
          // modifier keys. The controlled `checked` ignores the primitive's own
          // toggle, so driving selection from here doesn't double-fire.
          onClick={(event) => {
            event.stopPropagation()
            table.options.meta?.toggleRowSelected(row, !row.getIsSelected(), event.shiftKey)
          }}
          // a shift-click would otherwise extend the page's text selection over the rows
          onMouseDown={(event) => {
            if (event.shiftKey) event.preventDefault()
          }}
          aria-label="Select row"
        />
      )
  }
}
