import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  ACTION_LOG_IPC,
  IPC,
  type Account,
  type ActionLogEntry,
  type CategorizeScopeInput,
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
  type SyncResult,
  type Transaction,
  type TransactionIdsInput,
  type TransactionsSetCategoriesInput,
  type TransactionsSetTransferInput,
  type UndoResult
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
  LLM_IPC,
  type CategorizeProgress,
  type CategorizeResult,
  type LlmDownloadProgress,
  type LlmStatus
} from '@shared/llm'
import {
  RULES_IPC,
  type Rule,
  type RuleApplyOptions,
  type RuleCreateInput,
  type RuleReorderInput,
  type RuleUpdateInput,
  type RulePreview,
  type RulesApplyResult
} from '@shared/rules'
import {
  RULE_SUGGESTIONS_CREATED,
  RULE_SUGGESTIONS_IPC,
  type RuleSuggestion,
  type RuleSuggestionsCreatedEvent
} from '@shared/rule-suggestions'
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
    sync: (): Promise<SyncResult> => ipcRenderer.invoke(IPC.connectionSync),
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
    /** Per-row category values; skips pending rows, resolves to rows updated */
    setCategories: (input: TransactionsSetCategoriesInput): Promise<number> =>
      ipcRenderer.invoke(IPC.transactionsSetCategories, input),
    /** Soft delete; skips pending rows, resolves to the ids actually deleted */
    bulkDelete: (input: TransactionIdsInput): Promise<number[]> =>
      ipcRenderer.invoke(IPC.transactionsBulkDelete, input),
    /** Mark/unmark transfers; skips pending rows, resolves to rows updated */
    setTransfer: (input: TransactionsSetTransferInput): Promise<number> =>
      ipcRenderer.invoke(IPC.transactionsSetTransfer, input)
  },
  actionLog: {
    list: (): Promise<ActionLogEntry[]> => ipcRenderer.invoke(ACTION_LOG_IPC.list),
    /** Undo your newest action from this session; null if there's nothing to undo */
    undo: (): Promise<UndoResult | null> => ipcRenderer.invoke(ACTION_LOG_IPC.undo),
    /** Redo your most recently undone action from this session; null if nothing to redo */
    redo: (): Promise<UndoResult | null> => ipcRenderer.invoke(ACTION_LOG_IPC.redo),
    undoEntry: (id: number): Promise<UndoResult> =>
      ipcRenderer.invoke(ACTION_LOG_IPC.undoEntry, id),
    redoEntry: (id: number): Promise<UndoResult> => ipcRenderer.invoke(ACTION_LOG_IPC.redoEntry, id)
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
  rules: {
    list: (): Promise<Rule[]> => ipcRenderer.invoke(RULES_IPC.list),
    create: (input: RuleCreateInput): Promise<Rule> => ipcRenderer.invoke(RULES_IPC.create, input),
    update: (input: RuleUpdateInput): Promise<Rule> => ipcRenderer.invoke(RULES_IPC.update, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke(RULES_IPC.delete, id),
    reorder: (input: RuleReorderInput): Promise<boolean> =>
      ipcRenderer.invoke(RULES_IPC.reorder, input),
    /** Dry-run: what "apply" would change, grouped by rule; never writes */
    preview: (options?: RuleApplyOptions): Promise<RulePreview> =>
      ipcRenderer.invoke(RULES_IPC.preview, options),
    /** Backfill all untouched transactions; resolves to a change summary */
    apply: (options?: RuleApplyOptions): Promise<RulesApplyResult> =>
      ipcRenderer.invoke(RULES_IPC.apply, options)
  },
  ruleSuggestions: {
    list: (): Promise<RuleSuggestion[]> => ipcRenderer.invoke(RULE_SUGGESTIONS_IPC.list),
    dismiss: (id: number): Promise<boolean> => ipcRenderer.invoke(RULE_SUGGESTIONS_IPC.dismiss, id),
    accept: (id: number): Promise<boolean> => ipcRenderer.invoke(RULE_SUGGESTIONS_IPC.accept, id),
    /** Fires when the detector records new suggestions; returns an unsubscribe */
    onCreated: (callback: (event: RuleSuggestionsCreatedEvent) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        event: RuleSuggestionsCreatedEvent
      ): void => callback(event)
      ipcRenderer.on(RULE_SUGGESTIONS_CREATED, listener)
      return () => ipcRenderer.removeListener(RULE_SUGGESTIONS_CREATED, listener)
    }
  },
  settings: {
    getAll: (): Promise<Settings> => ipcRenderer.invoke(SETTINGS_IPC.getAll),
    set: <K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean> =>
      ipcRenderer.invoke(SETTINGS_IPC.set, { key, value })
  },
  llm: {
    getStatus: (): Promise<LlmStatus> => ipcRenderer.invoke(LLM_IPC.getStatus),
    /** Downloaded model file size in bytes, or null if it isn't on disk */
    getDiskSize: (): Promise<number | null> => ipcRenderer.invoke(LLM_IPC.getDiskSize),
    download: (): Promise<LlmStatus> => ipcRenderer.invoke(LLM_IPC.download),
    cancelDownload: (): Promise<void> => ipcRenderer.invoke(LLM_IPC.cancelDownload),
    /** Remove the downloaded model file to reclaim disk space */
    deleteModel: (): Promise<LlmStatus> => ipcRenderer.invoke(LLM_IPC.deleteModel),
    /** Auto-categorize a scope — a selection, one account, or (scope omitted) everything */
    categorize: (scope?: CategorizeScopeInput): Promise<CategorizeResult> =>
      ipcRenderer.invoke(LLM_IPC.categorize, scope ?? {}),
    /** Stop an in-flight categorize after the current row; partial results still apply */
    cancelCategorize: (): Promise<void> => ipcRenderer.invoke(LLM_IPC.cancelCategorize),
    onStatusChanged: (callback: (status: LlmStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: LlmStatus): void =>
        callback(status)
      ipcRenderer.on(LLM_IPC.statusChanged, listener)
      return () => ipcRenderer.removeListener(LLM_IPC.statusChanged, listener)
    },
    onDownloadProgress: (callback: (progress: LlmDownloadProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: LlmDownloadProgress): void =>
        callback(progress)
      ipcRenderer.on(LLM_IPC.downloadProgress, listener)
      return () => ipcRenderer.removeListener(LLM_IPC.downloadProgress, listener)
    },
    onCategorizeProgress: (callback: (progress: CategorizeProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: CategorizeProgress): void =>
        callback(progress)
      ipcRenderer.on(LLM_IPC.categorizeProgress, listener)
      return () => ipcRenderer.removeListener(LLM_IPC.categorizeProgress, listener)
    }
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
