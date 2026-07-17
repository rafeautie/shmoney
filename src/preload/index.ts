import { contextBridge, ipcRenderer } from 'electron'
import {
  ACTION_LOG_IPC,
  IPC,
  type Account,
  type SetInvertBalanceInput,
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
  type Holding,
  type Page,
  type SyncResult,
  type Transaction,
  type TransactionIdsInput,
  type TransactionsSetCategoriesInput,
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
import { STORAGE_IPC, type DatabaseSize } from '@shared/storage'
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
import {
  IMPORT_IPC,
  type ImportApplyInput,
  type ImportApplyResult,
  type ImportPreview,
  type ImportPreviewInput,
  type PickFileResult
} from '@shared/import'
import {
  CHAT_IPC,
  type ChatChunkEvent,
  type ChatMessageDoneEvent,
  type ChatToolCallEvent,
  type Conversation,
  type ConversationMessages,
  type RenameConversationInput,
  type SendChatInput,
  type SendChatResult,
  type SetConversationAccountInput
} from '@shared/chat'
import { UPDATES_IPC, type UpdateState } from '@shared/updates'
import { DIAGNOSTICS_IPC, LOG_IPC, type LogWriteInput } from '@shared/diagnostics'
import {
  BUDGETS_IPC,
  type BudgetRemoveInput,
  type BudgetRemoveResult,
  type BudgetSetFillInput,
  type BudgetSummary,
  type BudgetSummaryQuery
} from '@shared/budgets'

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
    setInvertBalance: (input: SetInvertBalanceInput): Promise<boolean> =>
      ipcRenderer.invoke(IPC.accountsSetInvertBalance, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.accountsDelete, id),
    holdings: (id: number): Promise<Holding[]> => ipcRenderer.invoke(IPC.accountHoldings, id),
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
      ipcRenderer.invoke(IPC.transactionsBulkDelete, input)
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
  budgets: {
    summary: (query: BudgetSummaryQuery): Promise<BudgetSummary> =>
      ipcRenderer.invoke(BUDGETS_IPC.summary, query),
    /** Upsert one month's fill; creating an envelope is the same call */
    setFill: (input: BudgetSetFillInput): Promise<boolean> =>
      ipcRenderer.invoke(BUDGETS_IPC.setFill, input),
    /** Deletes all of a category's fill rows; undo via actionLog.undoEntry(actionId) */
    remove: (input: BudgetRemoveInput): Promise<BudgetRemoveResult> =>
      ipcRenderer.invoke(BUDGETS_IPC.remove, input)
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
  import: {
    /**
     * Parse a transaction file: `dropped` bytes from drag-and-drop, or (input
     * omitted) the native open dialog; null when canceled. filePath is a
     * dev-only bypass.
     */
    pickFile: (input?: {
      filePath?: string
      dropped?: { fileName: string; bytes: Uint8Array }
    }): Promise<PickFileResult> => ipcRenderer.invoke(IMPORT_IPC.pickFile, input),
    /** Dry-run: normalized rows with duplicate statuses; never writes */
    preview: (input: ImportPreviewInput): Promise<ImportPreview> =>
      ipcRenderer.invoke(IMPORT_IPC.preview, input),
    /** Inserts the given rows (skipping id conflicts); undo via the Activity page */
    apply: (input: ImportApplyInput): Promise<ImportApplyResult> =>
      ipcRenderer.invoke(IMPORT_IPC.apply, input)
  },
  settings: {
    getAll: (): Promise<Settings> => ipcRenderer.invoke(SETTINGS_IPC.getAll),
    set: <K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean> =>
      ipcRenderer.invoke(SETTINGS_IPC.set, { key, value })
  },
  storage: {
    /** On-disk size of the SQLite database with a per-table breakdown */
    getDatabaseSize: (): Promise<DatabaseSize> => ipcRenderer.invoke(STORAGE_IPC.getDatabaseSize)
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
  chat: {
    listConversations: (): Promise<Conversation[]> =>
      ipcRenderer.invoke(CHAT_IPC.listConversations),
    /** the rows plus where the model's replay window starts (truncation marker) */
    listMessages: (conversationId: number): Promise<ConversationMessages> =>
      ipcRenderer.invoke(CHAT_IPC.listMessages, conversationId),
    /**
     * Send one turn (null conversationId creates the conversation). Resolves
     * once accepted; the reply arrives via onChunk/onMessageDone pushes.
     */
    send: (input: SendChatInput): Promise<SendChatResult> =>
      ipcRenderer.invoke(CHAT_IPC.send, input),
    /** Stop the in-flight reply; its partial text still lands via onMessageDone */
    stop: (): Promise<void> => ipcRenderer.invoke(CHAT_IPC.stop),
    rename: (input: RenameConversationInput): Promise<boolean> =>
      ipcRenderer.invoke(CHAT_IPC.renameConversation, input),
    /** Narrow (or widen, accountId null) the conversation's query scope; next turn on */
    setAccount: (input: SetConversationAccountInput): Promise<boolean> =>
      ipcRenderer.invoke(CHAT_IPC.setConversationAccount, input),
    /** Soft delete, restorable via restore (undo toast) */
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke(CHAT_IPC.deleteConversation, id),
    restore: (id: number): Promise<boolean> => ipcRenderer.invoke(CHAT_IPC.restoreConversation, id),
    onChunk: (callback: (event: ChatChunkEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: ChatChunkEvent): void =>
        callback(event)
      ipcRenderer.on(CHAT_IPC.chunk, listener)
      return () => ipcRenderer.removeListener(CHAT_IPC.chunk, listener)
    },
    onToolCall: (callback: (event: ChatToolCallEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: ChatToolCallEvent): void =>
        callback(event)
      ipcRenderer.on(CHAT_IPC.toolCall, listener)
      return () => ipcRenderer.removeListener(CHAT_IPC.toolCall, listener)
    },
    onMessageDone: (callback: (event: ChatMessageDoneEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: ChatMessageDoneEvent): void =>
        callback(event)
      ipcRenderer.on(CHAT_IPC.messageDone, listener)
      return () => ipcRenderer.removeListener(CHAT_IPC.messageDone, listener)
    }
  },
  updates: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATES_IPC.getState),
    /** Manual check; resolves to the state once the check has started */
    check: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATES_IPC.check),
    /** Quit and run the downloaded installer; no-op unless an update is downloaded */
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke(UPDATES_IPC.quitAndInstall),
    onStateChanged: (callback: (state: UpdateState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
        callback(state)
      ipcRenderer.on(UPDATES_IPC.stateChanged, listener)
      return () => ipcRenderer.removeListener(UPDATES_IPC.stateChanged, listener)
    }
  },
  log: {
    /** Fire-and-forget into the local log file; never blocks or rejects */
    write: (entry: LogWriteInput): void => ipcRenderer.send(LOG_IPC.write, entry)
  },
  diagnostics: {
    /** App/system info + recent scrubbed log lines, as shareable plain text */
    get: (): Promise<string> => ipcRenderer.invoke(DIAGNOSTICS_IPC.get),
    /** Copy previously previewed diagnostics text to the clipboard, byte for byte */
    copy: (text: string): Promise<void> => ipcRenderer.invoke(DIAGNOSTICS_IPC.copy, text),
    openLogsFolder: (): Promise<void> => ipcRenderer.invoke(DIAGNOSTICS_IPC.openLogsFolder)
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
  },
  debug: {
    // dev-only: the raw SimpleFIN /accounts payload. Rejects in production, where
    // the main-process handler is never registered (see main/ipc/debug).
    rawAccounts: (): Promise<unknown> => ipcRenderer.invoke(IPC.debugRawAccounts),
    versions: { ...process.versions } as Record<string, string | undefined>
  }
}

// The window always runs with contextIsolation enabled (see main/index.ts), so the
// bridge is the only path; only the curated `api` object is ever exposed.
contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
