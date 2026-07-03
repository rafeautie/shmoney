import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type Account,
  type AccountTransactionsQuery,
  type Connection,
  type ConnectionsQuery,
  type ConnectionTransactionsQuery,
  type CreateConnectionInput,
  type Page,
  type Transaction
} from '@shared/ipc'

const api = {
  connections: {
    list: (query: ConnectionsQuery): Promise<Page<Connection>> =>
      ipcRenderer.invoke(IPC.connectionsList, query),
    get: (id: number): Promise<Connection | null> => ipcRenderer.invoke(IPC.connectionsGet, id),
    create: (input: CreateConnectionInput): Promise<Connection> =>
      ipcRenderer.invoke(IPC.connectionsCreate, input),
    sync: (id: number): Promise<Connection> => ipcRenderer.invoke(IPC.connectionsSync, id),
    remove: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.connectionsRemove, id),
    transactions: (query: ConnectionTransactionsQuery): Promise<Page<Transaction>> =>
      ipcRenderer.invoke(IPC.transactionsList, query)
  },
  accounts: {
    list: (): Promise<Account[]> => ipcRenderer.invoke(IPC.accountsList),
    get: (id: number): Promise<Account | null> => ipcRenderer.invoke(IPC.accountsGet, id),
    transactions: (query: AccountTransactionsQuery): Promise<Page<Transaction>> =>
      ipcRenderer.invoke(IPC.accountTransactions, query)
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
