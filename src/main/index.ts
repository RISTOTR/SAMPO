import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  WebContents,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { IPC_CHANNELS } from '../shared/ipc'
import { registerApplicationIpcHandlers } from './ipc-handlers'
import { FileSecretStore } from './ai/secret-store'
import { formatErrorForDevelopment } from './domain/errors'
import { createApplicationDatabase, type SampoDatabase } from './storage/database'
import { ApplicationWorkflow } from './workflows/application-workflow'
import { NativeFileDialogAdapter } from './workflows/native-file-dialog'

let sampoDatabase: SampoDatabase | undefined
let workflow: ApplicationWorkflow | undefined

function isTrustedSender(sender: WebContents): boolean {
  const senderUrl = sender.getURL()

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    return senderUrl.startsWith(process.env['ELECTRON_RENDERER_URL'])
  }

  return senderUrl.startsWith('file://')
}

function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedSender(event.sender)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'Sampo',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const currentUrl = mainWindow.webContents.getURL()
    const currentOrigin = new URL(currentUrl).origin
    const nextOrigin = new URL(navigationUrl).origin

    if (nextOrigin !== currentOrigin) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app
  .whenReady()
  .then(() => {
    app.setName('Sampo')
    app.setAppUserModelId('es.ristotapani.sampo')
    sampoDatabase = createApplicationDatabase()
    workflow = new ApplicationWorkflow(
      sampoDatabase.connection,
      new NativeFileDialogAdapter(),
      FileSecretStore.forUserData()
    )

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    ipcMain.handle(IPC_CHANNELS.getAppInfo, (event) => {
      if (!isTrustedSender(event.sender)) {
        throw new Error('Rejected IPC call from untrusted sender')
      }

      return {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      }
    })

    registerApplicationIpcHandlers(workflow, isTrustedIpcSender)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
  .catch((error: unknown) => {
    console.error(formatErrorForDevelopment(error))
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  workflow?.clearPreviewSessions()
  workflow = undefined
  sampoDatabase?.close()
  sampoDatabase = undefined
})
