import { contextBridge, ipcRenderer } from 'electron'
import type { SampoApi } from '../shared/app-info'
import { IPC_CHANNELS } from '../shared/ipc'

const sampo: SampoApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo)
}

contextBridge.exposeInMainWorld('sampo', sampo)
