import { dialog, type BrowserWindow } from 'electron'
import type { FileDialogAdapter } from './import-preview-workflow'

export class NativeFileDialogAdapter implements FileDialogAdapter {
  async selectImportFile(window: BrowserWindow | undefined): Promise<string | undefined> {
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Select statement file',
          properties: ['openFile'],
          filters: [
            { name: 'Supported statements', extensions: ['xls', 'pdf'] },
            { name: 'Excel XLS', extensions: ['xls'] },
            { name: 'PDF', extensions: ['pdf'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Select statement file',
          properties: ['openFile'],
          filters: [
            { name: 'Supported statements', extensions: ['xls', 'pdf'] },
            { name: 'Excel XLS', extensions: ['xls'] },
            { name: 'PDF', extensions: ['pdf'] }
          ]
        })

    if (result.canceled) {
      return undefined
    }

    return result.filePaths[0]
  }
}
