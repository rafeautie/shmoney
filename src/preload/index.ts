import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type Account,
  type AccountTransactionsQuery,
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
  type TransactionSetCategoryInput,
  type TransactionsQuery
} from '@shared/ipc'

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
    transactions: (query: AccountTransactionsQuery): Promise<Page<Transaction>> =>
      ipcRenderer.invoke(IPC.accountTransactions, query)
  },
  transactions: {
    list: (query: TransactionsQuery): Promise<Page<Transaction>> =>
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
