import { contextBridge, ipcRenderer } from 'electron'
import type { SampoApi } from '../shared/app-info'
import { IPC_CHANNELS } from '../shared/ipc'

const sampo: SampoApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  overview: {
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.overviewGetStats)
  },
  accounts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.accountsList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.accountsCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.accountsUpdate, input),
    deleteUnused: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.accountsDeleteUnused, accountId)
  },
  imports: {
    selectAndInspect: (accountId) =>
      ipcRenderer.invoke(IPC_CHANNELS.importsSelectAndInspect, accountId),
    commitPreview: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.importsCommitPreview, sessionId),
    discardPreview: (sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.importsDiscardPreview, sessionId),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.importsList),
    rollback: (importBatchId) => ipcRenderer.invoke(IPC_CHANNELS.importsRollback, importBatchId)
  },
  transactions: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.transactionsList, query)
  },
  reconciliation: {
    listUnreconciledSettlements: () =>
      ipcRenderer.invoke(IPC_CHANNELS.reconciliationListSettlements),
    findCandidates: (settlementTransactionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.reconciliationFindCandidates, settlementTransactionId),
    preview: (settlementTransactionId, visaImportBatchId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.reconciliationPreview,
        settlementTransactionId,
        visaImportBatchId
      ),
    commit: (settlementTransactionId, visaImportBatchId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.reconciliationCommit,
        settlementTransactionId,
        visaImportBatchId
      ),
    reverse: (settlementTransactionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.reconciliationReverse, settlementTransactionId)
  }
}

contextBridge.exposeInMainWorld('sampo', sampo)
