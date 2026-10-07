import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_REPORT_FILTERS,
  DEFAULT_WIDGET_CONFIG,
  type NewWidget,
  type ReportFilters,
  type WidgetConfig
} from '@shared/reports'
import { SAVINGS_GOALS_TEMPLATE, SPENDING_OVERVIEW_TEMPLATE } from '@shared/report-templates'
import { api } from './harness/api'
import { count, query } from './harness/db'

const widget = (over: Partial<NewWidget> = {}): NewWidget => ({
  title: 'Spending',
  type: 'bar',
  config: DEFAULT_WIDGET_CONFIG,
  x: 0,
  y: 0,
  w: 4,
  h: 3,
  ...over
})

const T0 = 1_800_000_000
const at = (sec: number): void => {
  vi.setSystemTime(new Date(sec * 1000))
}

const updatedAt = (id: number): number =>
  query<{ updated_at: number }>(`SELECT updated_at FROM reports WHERE id = ${id}`)[0].updated_at

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(T0)
  // every test names the reports it creates; start each from none
  query('DELETE FROM reports')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('report CRUD', () => {
  it('creates a report with the default filters and no widgets', async () => {
    const report = await api.reports.create({ name: '  Monthly  ' })
    expect(report).toMatchObject({
      name: 'Monthly',
      filters: DEFAULT_REPORT_FILTERS,
      createdAt: T0,
      updatedAt: T0
    })
    expect(await api.reports.get(report.id)).toEqual({ report, widgets: [] })
  })

  it('creates a report with explicit filters, filling zod defaults', async () => {
    const report = await api.reports.create({
      name: 'Groceries',
      filters: { dateRange: { kind: 'all' }, accountIds: [1, 2], includeTransfers: true } as never
    })
    const expected: ReportFilters = {
      dateRange: { kind: 'all' },
      accountIds: [1, 2],
      direction: 'all',
      includePending: true,
      includeTransfers: true
    }
    expect(report.filters).toEqual(expected)
    expect((await api.reports.get(report.id))!.report.filters).toEqual(expected)
  })

  it('creates a report and its widgets together', async () => {
    const report = await api.reports.create({
      name: 'With widgets',
      widgets: [widget({ title: 'A' }), widget({ title: 'B', x: 4 })]
    })
    const detail = await api.reports.get(report.id)
    expect(detail!.widgets.map((w) => [w.title, w.reportId, w.x])).toEqual([
      ['A', report.id, 0],
      ['B', report.id, 4]
    ])
    expect(detail!.widgets[0].config).toEqual(DEFAULT_WIDGET_CONFIG)
  })

  it('writes nothing when a widget in the create is invalid', async () => {
    const bad = widget({ title: 'Bad', w: 13 })
    await expect(api.reports.create({ name: 'Doomed', widgets: [widget(), bad] })).rejects.toThrow()
    await expect(api.reports.create({ name: '   ' })).rejects.toThrow()
    expect(count('reports')).toBe(0)
    expect(count('report_widgets')).toBe(0)
  })

  it('get returns null for a report that does not exist', async () => {
    expect(await api.reports.get(987_654)).toBeNull()
  })

  it('update renames and replaces the filters, bumping updated_at', async () => {
    const report = await api.reports.create({ name: 'Old' })
    at(T0 + 60)
    const renamed = await api.reports.update({ id: report.id, name: 'New' })
    expect(renamed).toMatchObject({
      name: 'New',
      filters: DEFAULT_REPORT_FILTERS,
      createdAt: T0,
      updatedAt: T0 + 60
    })

    const filters = { dateRange: { kind: 'all' }, direction: 'expense' } as ReportFilters
    const refiltered = await api.reports.update({ id: report.id, filters })
    expect(refiltered.name).toBe('New')
    expect(refiltered.filters).toMatchObject({
      dateRange: { kind: 'all' },
      direction: 'expense',
      includePending: true,
      includeTransfers: false
    })
  })

  it('update rejects an unknown report and a blank name', async () => {
    await expect(api.reports.update({ id: 987_654, name: 'Ghost' })).rejects.toThrow(
      'Report 987654 not found'
    )
    const report = await api.reports.create({ name: 'Keep' })
    await expect(api.reports.update({ id: report.id, name: ' ' })).rejects.toThrow()
    expect((await api.reports.get(report.id))!.report.name).toBe('Keep')
  })

  it('delete cascades to the widgets and is true even when the report is gone', async () => {
    const report = await api.reports.create({
      name: 'Doomed',
      widgets: [widget(), widget({ x: 4 })]
    })
    const other = await api.reports.create({ name: 'Other', widgets: [widget()] })
    expect(count('report_widgets')).toBe(3)

    expect(await api.reports.delete(report.id)).toBe(true)
    expect(await api.reports.get(report.id)).toBeNull()
    expect(count('report_widgets', `report_id = ${report.id}`)).toBe(0)
    expect(count('report_widgets', `report_id = ${other.id}`)).toBe(1)

    expect(await api.reports.delete(report.id)).toBe(true)
    expect(await api.reports.delete(987_654)).toBe(true)
  })
})

describe('report list', () => {
  it('orders by updated_at descending and counts widgets', async () => {
    const first = await api.reports.create({ name: 'First', widgets: [widget(), widget({ x: 4 })] })
    at(T0 + 10)
    const second = await api.reports.create({ name: 'Second' })
    at(T0 + 20)
    const third = await api.reports.create({ name: 'Third', widgets: [widget()] })

    let list = await api.reports.list()
    expect(list.map((r) => [r.id, r.name, r.widgetCount])).toEqual([
      [third.id, 'Third', 1],
      [second.id, 'Second', 0],
      [first.id, 'First', 2]
    ])
    expect(list[1]).toMatchObject({ updatedAt: T0 + 10, filters: DEFAULT_REPORT_FILTERS })

    // touching a report moves it to the top
    at(T0 + 30)
    await api.reports.update({ id: first.id, name: 'First, edited' })
    list = await api.reports.list()
    expect(list.map((r) => r.name)).toEqual(['First, edited', 'Third', 'Second'])
  })

  it('previews the first widget by (y, x), or null with no widgets', async () => {
    const report = await api.reports.create({
      name: 'Preview',
      widgets: [
        widget({ title: 'Low left', x: 0, y: 1 }),
        widget({ title: 'Top right', x: 6, y: 0 }),
        widget({ title: 'Top middle', x: 2, y: 0 })
      ]
    })
    const empty = await api.reports.create({ name: 'Empty' })
    const list = await api.reports.list()
    expect(list.find((r) => r.id === report.id)!.preview).toMatchObject({
      title: 'Top middle',
      reportId: report.id,
      config: DEFAULT_WIDGET_CONFIG
    })
    expect(list.find((r) => r.id === empty.id)!.preview).toBeNull()
  })

  it('returns an empty list when there are no reports', async () => {
    expect(await api.reports.list()).toEqual([])
  })
})

describe('widgets', () => {
  it('widgetCreate adds to an existing report and touches its updated_at', async () => {
    const report = await api.reports.create({ name: 'Host' })
    at(T0 + 100)
    const created = await api.reports.widgetCreate({
      reportId: report.id,
      ...widget({ title: 'Net', type: 'stat', x: 8, y: 2, w: 4, h: 2 })
    })
    expect(created).toMatchObject({
      reportId: report.id,
      title: 'Net',
      type: 'stat',
      config: DEFAULT_WIDGET_CONFIG,
      x: 8,
      y: 2,
      w: 4,
      h: 2
    })
    expect(updatedAt(report.id)).toBe(T0 + 100)
    expect((await api.reports.get(report.id))!.widgets).toEqual([created])
  })

  it('widgetCreate requires the report to exist and writes nothing otherwise', async () => {
    await expect(api.reports.widgetCreate({ reportId: 987_654, ...widget() })).rejects.toThrow(
      'Report 987654 not found'
    )
    expect(count('report_widgets')).toBe(0)
  })

  it('widgetUpdate changes only the fields given and touches the report', async () => {
    const report = await api.reports.create({ name: 'Host', widgets: [widget({ title: 'Old' })] })
    const [existing] = (await api.reports.get(report.id))!.widgets
    at(T0 + 5)

    const retitled = await api.reports.widgetUpdate({ id: existing.id, title: 'New' })
    expect(retitled).toMatchObject({ title: 'New', type: 'bar', config: DEFAULT_WIDGET_CONFIG })
    expect(updatedAt(report.id)).toBe(T0 + 5)

    const config: WidgetConfig = {
      ...DEFAULT_WIDGET_CONFIG,
      query: { ...DEFAULT_WIDGET_CONFIG.query, measure: 'income', groupBy: 'account' }
    }
    const reconfigured = await api.reports.widgetUpdate({ id: existing.id, type: 'pie', config })
    expect(reconfigured).toMatchObject({ title: 'New', type: 'pie', config })
    expect(reconfigured).toMatchObject({ x: existing.x, y: existing.y, w: existing.w })
  })

  it('widgetUpdate rejects an unknown widget', async () => {
    await expect(api.reports.widgetUpdate({ id: 987_654, title: 'Ghost' })).rejects.toThrow(
      'Widget 987654 not found'
    )
  })

  it('widgetDelete removes the widget, touches the report, and is true when already gone', async () => {
    const report = await api.reports.create({
      name: 'Host',
      widgets: [widget({ title: 'Keep' }), widget({ title: 'Drop', x: 4 })]
    })
    const drop = (await api.reports.get(report.id))!.widgets.find((w) => w.title === 'Drop')!
    at(T0 + 7)

    expect(await api.reports.widgetDelete(drop.id)).toBe(true)
    expect((await api.reports.get(report.id))!.widgets.map((w) => w.title)).toEqual(['Keep'])
    expect(updatedAt(report.id)).toBe(T0 + 7)

    at(T0 + 8)
    expect(await api.reports.widgetDelete(drop.id)).toBe(true)
    expect(updatedAt(report.id)).toBe(T0 + 7)
  })

  it('widgetLayouts moves only widgets that belong to the report', async () => {
    const report = await api.reports.create({
      name: 'Mine',
      widgets: [widget({ title: 'A' }), widget({ title: 'B', x: 4 })]
    })
    const other = await api.reports.create({ name: 'Other', widgets: [widget({ title: 'Z' })] })
    const [a, b] = (await api.reports.get(report.id))!.widgets
    const [z] = (await api.reports.get(other.id))!.widgets
    at(T0 + 9)

    expect(
      await api.reports.widgetLayouts({
        reportId: report.id,
        layouts: [
          { id: a.id, x: 6, y: 1, w: 6, h: 4 },
          { id: b.id, x: 0, y: 5, w: 3, h: 2 },
          { id: z.id, x: 11, y: 11, w: 1, h: 1 }
        ]
      })
    ).toBe(true)

    const after = (await api.reports.get(report.id))!.widgets
    expect(after.map((w) => [w.title, w.x, w.y, w.w, w.h])).toEqual([
      ['A', 6, 1, 6, 4],
      ['B', 0, 5, 3, 2]
    ])
    expect((await api.reports.get(other.id))!.widgets[0]).toMatchObject({
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h
    })
    expect(updatedAt(report.id)).toBe(T0 + 9)
    expect(updatedAt(other.id)).toBe(T0)
  })

  it('widgetLayouts rejects out-of-range cells and an empty list', async () => {
    const report = await api.reports.create({ name: 'Mine', widgets: [widget()] })
    const [w] = (await api.reports.get(report.id))!.widgets
    const move = (over: object): Promise<boolean> =>
      api.reports.widgetLayouts({
        reportId: report.id,
        layouts: [{ id: w.id, x: 0, y: 0, w: 4, h: 3, ...over }]
      })
    await expect(move({ w: 13 })).rejects.toThrow()
    await expect(move({ x: 12 })).rejects.toThrow()
    await expect(move({ h: 0 })).rejects.toThrow()
    await expect(api.reports.widgetLayouts({ reportId: report.id, layouts: [] })).rejects.toThrow()
    expect((await api.reports.get(report.id))!.widgets[0]).toMatchObject({ x: 0, w: 4, h: 3 })
  })

  it('rejects a widget that overflows the grid, on layout and on create', async () => {
    const report = await api.reports.create({ name: 'Overflow', widgets: [widget()] })
    const [w] = (await api.reports.get(report.id))!.widgets
    await expect(
      api.reports.widgetLayouts({
        reportId: report.id,
        layouts: [{ id: w.id, x: 8, y: 0, w: 5, h: 3 }]
      })
    ).rejects.toThrow()
    // the right edge itself is fine
    expect(
      await api.reports.widgetLayouts({
        reportId: report.id,
        layouts: [{ id: w.id, x: 8, y: 0, w: 4, h: 3 }]
      })
    ).toBe(true)
    await expect(
      api.reports.create({ name: 'Too wide', widgets: [widget({ x: 6, w: 7 })] })
    ).rejects.toThrow()
    expect((await api.reports.get(report.id))!.widgets[0]).toMatchObject({ x: 8, w: 4 })
  })
})

describe('stored configs', () => {
  it('degrades a config that no longer parses to null, in get and in the list preview', async () => {
    const report = await api.reports.create({
      name: 'Stale',
      widgets: [widget({ title: 'Old shape' }), widget({ title: 'Fine', x: 4 })]
    })
    const [old] = (await api.reports.get(report.id))!.widgets
    query(
      `UPDATE report_widgets SET config = '{"query":{"measure":"median"}}' WHERE id = ${old.id}`
    )

    const detail = await api.reports.get(report.id)
    expect(detail!.widgets.map((w) => [w.title, w.config === null])).toEqual([
      ['Old shape', true],
      ['Fine', false]
    ])
    expect(detail!.widgets[0]).toMatchObject({ type: 'bar', x: 0, w: 4 })
    expect((await api.reports.list())[0].preview).toMatchObject({
      title: 'Old shape',
      config: null
    })

    // reconfiguring the widget recovers it
    const fixed = await api.reports.widgetUpdate({ id: old.id, config: DEFAULT_WIDGET_CONFIG })
    expect(fixed.config).toEqual(DEFAULT_WIDGET_CONFIG)
  })

  it('fills a defaulted field missing from an older stored config', async () => {
    const report = await api.reports.create({ name: 'Older', widgets: [widget()] })
    const [w] = (await api.reports.get(report.id))!.widgets
    const legacy = {
      query: { measure: 'sum', groupBy: 'none', timeGrain: 'month' },
      filters: { mode: 'inherit', overrides: {} }
    }
    query(`UPDATE report_widgets SET config = '${JSON.stringify(legacy)}' WHERE id = ${w.id}`)
    expect((await api.reports.get(report.id))!.widgets[0].config).toEqual({
      ...legacy,
      query: { ...legacy.query, source: 'transactions', cumulative: false }
    })
  })
})

describe('templates', () => {
  it.each([
    ['Spending Overview', SPENDING_OVERVIEW_TEMPLATE],
    ['Savings Goals', SAVINGS_GOALS_TEMPLATE]
  ])('%s round-trips through get', async (_name, template) => {
    const report = await api.reports.create(template)
    const detail = await api.reports.get(report.id)
    expect(detail!.report).toMatchObject({
      name: template.name,
      filters: template.filters ?? DEFAULT_REPORT_FILTERS
    })
    const expected = [...template.widgets!].sort((a, b) => a.y - b.y || a.x - b.x)
    expect(detail!.widgets).toHaveLength(expected.length)
    expect(expected.length).toBeGreaterThan(0)
    detail!.widgets.forEach((got, i) => {
      expect(got).toMatchObject({ reportId: report.id, ...expected[i], config: expected[i].config })
    })
    expect((await api.reports.list())[0]).toMatchObject({
      id: report.id,
      widgetCount: expected.length
    })
  })
})

describe('action log', () => {
  it('records nothing for any report operation', async () => {
    const before = [count('action_log'), count('action_runs')]
    const report = await api.reports.create({ name: 'Quiet', widgets: [widget()] })
    const [w] = (await api.reports.get(report.id))!.widgets
    await api.reports.update({ id: report.id, name: 'Quieter' })
    const added = await api.reports.widgetCreate({ reportId: report.id, ...widget({ x: 4 }) })
    await api.reports.widgetUpdate({ id: added.id, title: 'Renamed' })
    await api.reports.widgetLayouts({
      reportId: report.id,
      layouts: [{ id: w.id, x: 1, y: 1, w: 2, h: 2 }]
    })
    await api.reports.widgetDelete(added.id)
    await api.reports.delete(report.id)
    expect([count('action_log'), count('action_runs')]).toEqual(before)
  })
})
