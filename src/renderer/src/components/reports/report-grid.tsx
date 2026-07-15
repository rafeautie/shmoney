import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GridLayout, type Layout, type LayoutItem } from 'react-grid-layout'
import type { ReportFilters, ReportWidget, WidgetType } from '@shared/reports'
import { createReportCompactor, type ActiveGridOperation } from './grid-compactor'
import { WidgetCard } from './widget-card'

/** Container width that only updates once resizing settles. Unlike react-grid-layout's
 * useContainerWidth (which fires every frame), this keeps the grid and its charts from
 * chasing the sidebar's collapse animation frame by frame; instead the grid re-lays-out
 * once at the end, animated by the grid items' own CSS transition. */
function useSettledContainerWidth(delayMs: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    setWidth(node.offsetWidth)
    let timer: number | undefined
    const observer = new ResizeObserver(([entry]) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setWidth(entry.contentRect.width), delayMs)
    })
    observer.observe(node)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [delayMs])

  return { width, containerRef, mounted: width > 0 }
}

const GRID_COLS = 12
const GRID_ROW_HEIGHT = 56

const MIN_SIZES: Record<WidgetType, { minW: number; minH: number }> = {
  stat: { minW: 3, minH: 2 },
  line: { minW: 4, minH: 3 },
  bar: { minW: 4, minH: 3 },
  area: { minW: 4, minH: 3 },
  pie: { minW: 4, minH: 3 },
  radar: { minW: 4, minH: 3 },
  radial: { minW: 4, minH: 3 },
  summaryTable: { minW: 4, minH: 3 },
  transactions: { minW: 5, minH: 4 },
  budget: { minW: 4, minH: 3 }
}

interface ReportGridProps {
  widgets: ReportWidget[]
  reportFilters: ReportFilters
  editing: boolean
  onLayoutChange: (layout: Layout) => void
  onEditWidget: (widget: ReportWidget) => void
  onDeleteWidget: (widget: ReportWidget) => void
}

export function ReportGrid({
  widgets,
  reportFilters,
  editing,
  onLayoutChange,
  onEditWidget,
  onDeleteWidget
}: ReportGridProps) {
  const { width, containerRef, mounted } = useSettledContainerWidth(150)

  const activeOpRef = useRef<ActiveGridOperation | null>(null)
  const compactor = useMemo(() => createReportCompactor(activeOpRef), [])
  const beginOperation = useCallback(
    (kind: ActiveGridOperation['kind']) => (opLayout: Layout, oldItem: LayoutItem | null) => {
      if (!oldItem) return
      activeOpRef.current = {
        id: oldItem.i,
        kind,
        snapshot: new Map(
          opLayout.filter((l): l is LayoutItem => l !== undefined).map((l) => [l.i, { ...l }])
        ),
        swapWith: [],
        accepted: { x: oldItem.x, y: oldItem.y, w: oldItem.w, h: oldItem.h }
      }
    },
    []
  )
  const onDragStart = useMemo(() => beginOperation('drag'), [beginOperation])
  const onResizeStart = useMemo(() => beginOperation('resize'), [beginOperation])
  const endOperation = useCallback(() => {
    activeOpRef.current = null
  }, [])

  const layout = useMemo<Layout>(
    () =>
      widgets.map((w) => ({
        i: String(w.id),
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        ...MIN_SIZES[w.type]
      })),
    [widgets]
  )

  return (
    <div ref={containerRef}>
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          /* push-down/swap collision behavior; also avoids the default vertical
           * compactor's upward re-pack, which snapped items back up when
           * shrinking from a top handle */
          compactor={compactor}
          onDragStart={onDragStart}
          onDragStop={endOperation}
          onResizeStart={onResizeStart}
          onResizeStop={endOperation}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: GRID_ROW_HEIGHT,
            margin: [16, 16],
            containerPadding: [0, 0]
          }}
          dragConfig={{ enabled: editing, cancel: 'button, a, input, select, textarea' }}
          resizeConfig={{ enabled: editing, handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] }}
          onLayoutChange={onLayoutChange}
        >
          {widgets.map((widget) => (
            <div key={String(widget.id)}>
              <WidgetCard
                widget={widget}
                reportFilters={reportFilters}
                editing={editing}
                onEdit={() => onEditWidget(widget)}
                onDelete={() => onDeleteWidget(widget)}
              />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  )
}
