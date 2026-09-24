import './shims/globals'
import { runMigrations } from './db'
import { registerConnectionsIpc } from '../main/ipc/connections'
import { registerCategoriesIpc } from '../main/ipc/categories'
import { registerTransactionsIpc } from '../main/ipc/transactions'
import { registerActionLogIpc } from '../main/ipc/action-log'
import { registerReportsIpc } from '../main/ipc/reports'
import { registerBudgetsIpc } from '../main/ipc/budgets'
import { registerSavedFiltersIpc } from '../main/ipc/saved-filters'
import { registerRulesIpc } from '../main/ipc/rules'
import { registerRuleSuggestionsIpc } from '../main/ipc/rule-suggestions'
import { registerSettingsIpc } from '../main/ipc/settings'
import { registerImportIpc } from '../main/ipc/import'
import { registerAppIpc } from '../main/ipc/app'
import { registerLlmIpc } from '../main/ipc/llm'
import { registerChatIpc } from '../main/ipc/chat'
import { registerLogIpc } from '../main/ipc/log'
import { registerDemoIpc } from '../main/ipc/demo'
import { registerOverrides } from './overrides'
import { containScrolling } from './contain-scrolling'
import { applyEmbedConfig, readEmbedConfig, startEmbedBridge } from './embed'
import '../preload/index'

// The whole desktop app in one page: the main process's migrations and IPC
// handlers run against in-memory SQLite, the real preload exposes window.api
// over the shimmed IPC, and then the real renderer boots on top.

runMigrations()
registerConnectionsIpc()
registerCategoriesIpc()
registerTransactionsIpc()
registerActionLogIpc()
registerReportsIpc()
registerBudgetsIpc()
registerSavedFiltersIpc()
registerRulesIpc()
registerRuleSuggestionsIpc()
registerSettingsIpc()
registerImportIpc()
registerAppIpc()
registerLlmIpc()
registerChatIpc()
registerLogIpc()
registerDemoIpc()
registerOverrides()

containScrolling()
const config = readEmbedConfig()
await applyEmbedConfig(config)
// the renderer reads settings at import time, so it loads once data is in place
await import('../renderer/src/main')
startEmbedBridge(config)
