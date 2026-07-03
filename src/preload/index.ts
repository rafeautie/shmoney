import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type Account,
  type AccountTransactionsQuery,
  type ConnectInput,
  type Connection,
  type Page,
  type Transaction,
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
      ipcRenderer.invoke(IPC.transactionsList, query)
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
