import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type Account,
  type CategoriesList,
  type Category,
  type CategoryCreateInput,
  type CategoryGroup,
  type CategoryGroupCreateInput,
  type CategoryGroupRenameInput,
  type CategoryRenameInput,
  type ConnectInput,
  type Connection,
  type Page,
  type Transaction,
  type TransactionSetCategoryInput
} from '@shared/ipc'
import {
  SAVED_FILTERS_IPC,
  type FilteredAccountTransactionsQuery,
  type FilteredTransactionsQuery,
  type SavedFilter,
  type SavedFilterCreateInput,
  type SavedFilterUpdateInput
} from '@shared/transaction-filters'
import { SETTINGS_IPC, type SettingKey, type Settings } from '@shared/settings'
import {
  REPORTS_IPC,
  type Report,
  type ReportCreateInput,
  type ReportDetail,
  type ReportSummary,
  type ReportTransactionsQuery,
  type ReportUpdateInput,
  type ReportWidget,
  type ResolvedQuery,
  type RunQueryResult,
  type WidgetCreateInput,
  type WidgetLayoutsInput,
  type WidgetUpdateInput
} from '@shared/reports'

const api = {
  connection: {
    get: (): Promise<Connection | null> => ipcRenderer.invoke(IPC.connectionGet),
    connect: (input: ConnectInput): Promise<Connection> =>
      ipcRenderer.invoke(IPC.connectionConnect, input),
    sync: (): Promise<Connection> => ipcRenderer.invoke(IPC.connectionSync),
    disconnect: (): Promise<boolean> => ipcRenderer.invoke(IPC.connectionDisconnect)
  },
  accounts: {
    list: (): Promise<Account[]> => ipcRenderer.invoke(IPC.accountsList),
    get: (id: number): Promise<Account | null> => ipcRenderer.invoke(IPC.accountsGet, id),
    transactions: (query: FilteredAccountTransactionsQuery): Promise<Page<Transaction>> =>
      ipcRenderer.invoke(IPC.accountTransactions, query)
  },
  transactions: {
    list: (query: FilteredTransactionsQuery): Promise<Page<Transaction>> =>
      ipcRenderer.invoke(IPC.transactionsList, query),
    setCategory: (input: TransactionSetCategoryInput): Promise<boolean> =>
      ipcRenderer.invoke(IPC.transactionsSetCategory, input)
  },
  categories: {
    list: (): Promise<CategoriesList> => ipcRenderer.invoke(IPC.categoriesList),
    createGroup: (input: CategoryGroupCreateInput): Promise<CategoryGroup> =>
      ipcRenderer.invoke(IPC.categoriesCreateGroup, input),
    renameGroup: (input: CategoryGroupRenameInput): Promise<boolean> =>
      ipcRenderer.invoke(IPC.categoriesRenameGroup, input),
    deleteGroup: (id: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.categoriesDeleteGroup, id),
    create: (input: CategoryCreateInput): Promise<Category> =>
      ipcRenderer.invoke(IPC.categoriesCreate, input),
    rename: (input: CategoryRenameInput): Promise<boolean> =>
      ipcRenderer.invoke(IPC.categoriesRename, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.categoriesDelete, id),
    resetDefaults: (): Promise<CategoriesList> => ipcRenderer.invoke(IPC.categoriesResetDefaults)
  },
  reports: {
    list: (): Promise<ReportSummary[]> => ipcRenderer.invoke(REPORTS_IPC.list),
    get: (id: number): Promise<ReportDetail> => ipcRenderer.invoke(REPORTS_IPC.get, id),
    create: (input: ReportCreateInput): Promise<Report> =>
      ipcRenderer.invoke(REPORTS_IPC.create, input),
    update: (input: ReportUpdateInput): Promise<Report> =>
      ipcRenderer.invoke(REPORTS_IPC.update, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke(REPORTS_IPC.delete, id),
    widgetCreate: (input: WidgetCreateInput): Promise<ReportWidget> =>
      ipcRenderer.invoke(REPORTS_IPC.widgetCreate, input),
    widgetUpdate: (input: WidgetUpdateInput): Promise<ReportWidget> =>
      ipcRenderer.invoke(REPORTS_IPC.widgetUpdate, input),
    widgetDelete: (id: number): Promise<boolean> =>
      ipcRenderer.invoke(REPORTS_IPC.widgetDelete, id),
    widgetLayouts: (input: WidgetLayoutsInput): Promise<boolean> =>
      ipcRenderer.invoke(REPORTS_IPC.widgetLayouts, input),
    runQuery: (query: ResolvedQuery): Promise<RunQueryResult> =>
      ipcRenderer.invoke(REPORTS_IPC.runQuery, query),
    transactions: (query: ReportTransactionsQuery): Promise<Page<Transaction>> =>
      ipcRenderer.invoke(REPORTS_IPC.transactions, query)
  },
  savedFilters: {
    list: (): Promise<SavedFilter[]> => ipcRenderer.invoke(SAVED_FILTERS_IPC.list),
    create: (input: SavedFilterCreateInput): Promise<SavedFilter> =>
      ipcRenderer.invoke(SAVED_FILTERS_IPC.create, input),
    update: (input: SavedFilterUpdateInput): Promise<SavedFilter> =>
      ipcRenderer.invoke(SAVED_FILTERS_IPC.update, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke(SAVED_FILTERS_IPC.delete, id)
  },
  settings: {
    getAll: (): Promise<Settings> => ipcRenderer.invoke(SETTINGS_IPC.getAll),
    set: <K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean> =>
      ipcRenderer.invoke(SETTINGS_IPC.set, { key, value })
  },
  window: {
    minimize: (): void => ipcRenderer.send(IPC.windowMinimize),
    maximizeToggle: (): void => ipcRenderer.send(IPC.windowMaximizeToggle),
    close: (): void => ipcRenderer.send(IPC.windowClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        callback(maximized)
      ipcRenderer.on(IPC.windowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts, only hit when contextIsolation is disabled)
  window.electron = electronAPI
  // @ts-ignore (define in dts, only hit when contextIsolation is disabled)
  window.api = api
}

export type Api = typeof api
