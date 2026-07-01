import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC, type CreateNoteInput, type Note, type UpdateNoteInput } from '@shared/ipc'

const api = {
  notes: {
    list: (): Promise<Note[]> => ipcRenderer.invoke(IPC.notesList),
    create: (input: CreateNoteInput): Promise<Note> => ipcRenderer.invoke(IPC.notesCreate, input),
    update: (input: UpdateNoteInput): Promise<Note> => ipcRenderer.invoke(IPC.notesUpdate, input),
    remove: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.notesRemove, id)
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
