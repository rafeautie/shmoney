import { ipcMain } from 'electron'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { reports, reportWidgets, type ReportRow, type ReportWidgetRow } from '../db/schema'
import { runQuery } from '../reports/query'
import { buildWhere } from '../reports/query'
import { transactionsPage } from './transactions-page'
import { idSchema } from '@shared/ipc'
import {
  DEFAULT_REPORT_FILTERS,
  REPORTS_IPC,
  reportCreateSchema,
  reportTransactionsQuerySchema,
  reportUpdateSchema,
  resolvedQuerySchema,
  widgetConfigSchema,
  widgetCreateSchema,
  widgetLayoutsSchema,
  widgetUpdateSchema,
  type Report,
  type ReportDetail,
  type ReportSummary,
  type ReportWidget
} from '@shared/reports'

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function toWidget(row: ReportWidgetRow): ReportWidget {
  // configs are versioned JSON; if a stored config no longer parses, degrade to
  // null so the renderer shows a "reconfigure" card instead of crashing
  const parsed = widgetConfigSchema.safeParse(row.config)
  return {
    id: row.id,
    reportId: row.reportId,
    title: row.title,
    type: row.type,
    config: parsed.success ? parsed.data : null,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h
  }
}

function touchReport(id: number): void {
  db.update(reports).set({ updatedAt: nowSec() }).where(eq(reports.id, id)).run()
}

function getReportRow(id: number): ReportRow {
  const row = db.select().from(reports).where(eq(reports.id, id)).get()
  if (!row) throw new Error(`Report ${id} not found`)
  return row
}

export function registerReportsIpc(): void {
  ipcMain.handle(REPORTS_IPC.list, (): ReportSummary[] => {
    return db
      .select({
        id: reports.id,
        name: reports.name,
        widgetCount: count(reportWidgets.id),
        updatedAt: reports.updatedAt
      })
      .from(reports)
      .leftJoin(reportWidgets, eq(reportWidgets.reportId, reports.id))
      .groupBy(reports.id)
      .orderBy(desc(reports.updatedAt))
      .all()
  })

  ipcMain.handle(REPORTS_IPC.get, (_event, input: unknown): ReportDetail => {
    const id = idSchema.parse(input)
    const report = getReportRow(id)
    const widgets = db
      .select()
      .from(reportWidgets)
      .where(eq(reportWidgets.reportId, id))
      .orderBy(asc(reportWidgets.y), asc(reportWidgets.x))
      .all()
      .map(toWidget)
    return { report, widgets }
  })

  ipcMain.handle(REPORTS_IPC.create, (_event, input: unknown): Report => {
    const { name, filters, widgets } = reportCreateSchema.parse(input)
    const now = nowSec()
    return db.transaction((tx) => {
      const [report] = tx
        .insert(reports)
        .values({
          name,
          filters: filters ?? DEFAULT_REPORT_FILTERS,
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .all()
      if (widgets?.length) {
        tx.insert(reportWidgets)
          .values(widgets.map((w) => ({ ...w, reportId: report.id })))
          .run()
      }
      return report
    })
  })

  ipcMain.handle(REPORTS_IPC.update, (_event, input: unknown): Report => {
    const { id, name, filters } = reportUpdateSchema.parse(input)
    const [row] = db
      .update(reports)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(filters !== undefined ? { filters } : {}),
        updatedAt: nowSec()
      })
      .where(eq(reports.id, id))
      .returning()
      .all()
    if (!row) throw new Error(`Report ${id} not found`)
    return row
  })

  ipcMain.handle(REPORTS_IPC.delete, (_event, input: unknown): boolean => {
    const id = idSchema.parse(input)
    // cascades to report_widgets
    db.delete(reports).where(eq(reports.id, id)).run()
    return true
  })

  ipcMain.handle(REPORTS_IPC.widgetCreate, (_event, input: unknown): ReportWidget => {
    const { reportId, ...values } = widgetCreateSchema.parse(input)
    getReportRow(reportId)
    const [row] = db
      .insert(reportWidgets)
      .values({ ...values, reportId })
      .returning()
      .all()
    touchReport(reportId)
    return toWidget(row)
  })

  ipcMain.handle(REPORTS_IPC.widgetUpdate, (_event, input: unknown): ReportWidget => {
    const { id, ...changes } = widgetUpdateSchema.parse(input)
    const [row] = db
      .update(reportWidgets)
      .set({
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.type !== undefined ? { type: changes.type } : {}),
        ...(changes.config !== undefined ? { config: changes.config } : {})
      })
      .where(eq(reportWidgets.id, id))
      .returning()
      .all()
    if (!row) throw new Error(`Widget ${id} not found`)
    touchReport(row.reportId)
    return toWidget(row)
  })

  ipcMain.handle(REPORTS_IPC.widgetDelete, (_event, input: unknown): boolean => {
    const id = idSchema.parse(input)
    const [row] = db.delete(reportWidgets).where(eq(reportWidgets.id, id)).returning().all()
    if (row) touchReport(row.reportId)
    return true
  })

  ipcMain.handle(REPORTS_IPC.widgetLayouts, (_event, input: unknown): boolean => {
    const { reportId, layouts } = widgetLayoutsSchema.parse(input)
    db.transaction((tx) => {
      for (const { id, x, y, w, h } of layouts) {
        tx.update(reportWidgets)
          .set({ x, y, w, h })
          .where(and(eq(reportWidgets.id, id), eq(reportWidgets.reportId, reportId)))
          .run()
      }
      tx.update(reports).set({ updatedAt: nowSec() }).where(eq(reports.id, reportId)).run()
    })
    return true
  })

  ipcMain.handle(REPORTS_IPC.runQuery, (_event, input: unknown) => {
    const q = resolvedQuerySchema.parse(input)
    return runQuery(q)
  })

  ipcMain.handle(REPORTS_IPC.transactions, (_event, input: unknown) => {
    const q = reportTransactionsQuerySchema.parse(input)
    return transactionsPage(buildWhere(q.filters), q)
  })
}
