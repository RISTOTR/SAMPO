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
  },
  categories: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.categoriesList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.categoriesCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.categoriesUpdate, input),
    deactivate: (id) => ipcRenderer.invoke(IPC_CHANNELS.categoriesDeactivate, id),
    reactivate: (id) => ipcRenderer.invoke(IPC_CHANNELS.categoriesReactivate, id),
    deleteUnused: (id) => ipcRenderer.invoke(IPC_CHANNELS.categoriesDeleteUnused, id)
  },
  merchants: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.merchantsList, query),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.merchantsCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.merchantsUpdate, input)
  },
  merchantAliases: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.merchantAliasesList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.merchantAliasesCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.merchantAliasesUpdate, input),
    deactivate: (id) => ipcRenderer.invoke(IPC_CHANNELS.merchantAliasesDeactivate, id)
  },
  classification: {
    get: (transactionId) => ipcRenderer.invoke(IPC_CHANNELS.classificationGet, transactionId),
    saveManual: (input) => ipcRenderer.invoke(IPC_CHANNELS.classificationSaveManual, input),
    previewRule: (input) => ipcRenderer.invoke(IPC_CHANNELS.classificationPreviewRule, input),
    createRule: (input) => ipcRenderer.invoke(IPC_CHANNELS.classificationCreateRule, input),
    applyRule: (input) => ipcRenderer.invoke(IPC_CHANNELS.classificationApplyRule, input),
    bulkUpdate: (input) => ipcRenderer.invoke(IPC_CHANNELS.classificationBulkUpdate, input)
  },
  rules: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.rulesList),
    activate: (id) => ipcRenderer.invoke(IPC_CHANNELS.rulesActivate, id),
    deactivate: (id) => ipcRenderer.invoke(IPC_CHANNELS.rulesDeactivate, id)
  },
  ai: {
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.aiGetSettings),
    saveOpenAiApiKey: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiSaveOpenAiApiKey, input),
    deleteOpenAiApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.aiDeleteOpenAiApiKey),
    updateSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiUpdateSettings, input),
    testConnection: () => ipcRenderer.invoke(IPC_CHANNELS.aiTestConnection),
    smartClassify: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiSmartClassify, input),
    smartClassifyImportBatch: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiSmartClassifyImportBatch, input),
    listSuggestions: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiListSuggestions, input),
    acceptSuggestion: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiAcceptSuggestion, input),
    rejectSuggestion: (input) => ipcRenderer.invoke(IPC_CHANNELS.aiRejectSuggestion, input)
  }
}

contextBridge.exposeInMainWorld('sampo', sampo)
