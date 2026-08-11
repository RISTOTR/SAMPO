import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS } from '../shared/ipc'
import type { ApiResult } from '../shared/dtos'
import { ApplicationWorkflow } from './workflows/application-workflow'
import { toOperationError } from './workflows/errors'

type TrustedSenderCheck = (event: IpcMainInvokeEvent) => boolean

export function registerApplicationIpcHandlers(
  workflow: ApplicationWorkflow,
  isTrustedSender: TrustedSenderCheck
): void {
  handle(IPC_CHANNELS.overviewGetStats, isTrustedSender, () => workflow.getOverviewStats())
  handle(IPC_CHANNELS.accountsList, isTrustedSender, () => workflow.listAccounts())
  handle(IPC_CHANNELS.accountsCreate, isTrustedSender, (input) => workflow.createAccount(input))
  handle(IPC_CHANNELS.accountsUpdate, isTrustedSender, (input) => workflow.updateAccount(input))
  handle(IPC_CHANNELS.accountsDeleteUnused, isTrustedSender, (accountId) => {
    workflow.deleteUnusedAccount(z.string().uuid().parse(accountId))
  })
  handle(IPC_CHANNELS.importsSelectAndInspect, isTrustedSender, (accountId, event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return workflow.selectAndInspectImport(z.string().uuid().parse(accountId), window)
  })
  handle(IPC_CHANNELS.importsCommitPreview, isTrustedSender, (sessionId) =>
    workflow.commitImportPreview(z.string().uuid().parse(sessionId))
  )
  handle(IPC_CHANNELS.importsDiscardPreview, isTrustedSender, (sessionId) => {
    workflow.discardImportPreview(z.string().uuid().parse(sessionId))
  })
  handle(IPC_CHANNELS.importsList, isTrustedSender, () => workflow.listImportBatches())
  handle(IPC_CHANNELS.importsRollback, isTrustedSender, (importBatchId) =>
    workflow.rollbackImportBatch(z.string().uuid().parse(importBatchId))
  )
  handle(IPC_CHANNELS.transactionsList, isTrustedSender, (query) =>
    workflow.listTransactions(query as never)
  )
  handle(IPC_CHANNELS.reconciliationListSettlements, isTrustedSender, () =>
    workflow.listUnreconciledSettlements()
  )
  handle(IPC_CHANNELS.reconciliationFindCandidates, isTrustedSender, (settlementTransactionId) =>
    workflow.findReconciliationCandidates(z.string().uuid().parse(settlementTransactionId))
  )
  handle(
    IPC_CHANNELS.reconciliationPreview,
    isTrustedSender,
    (settlementTransactionId, _event, visaImportBatchId) =>
      workflow.previewReconciliation(
        z.string().uuid().parse(settlementTransactionId),
        z.string().uuid().parse(visaImportBatchId)
      )
  )
  handle(
    IPC_CHANNELS.reconciliationCommit,
    isTrustedSender,
    (settlementTransactionId, _event, visaImportBatchId) =>
      workflow.commitReconciliation(
        z.string().uuid().parse(settlementTransactionId),
        z.string().uuid().parse(visaImportBatchId)
      )
  )
  handle(IPC_CHANNELS.reconciliationReverse, isTrustedSender, (settlementTransactionId) =>
    workflow.reverseReconciliation(z.string().uuid().parse(settlementTransactionId))
  )
  handle(IPC_CHANNELS.categoriesList, isTrustedSender, () => workflow.listCategories())
  handle(IPC_CHANNELS.categoriesCreate, isTrustedSender, (input) => workflow.createCategory(input))
  handle(IPC_CHANNELS.categoriesUpdate, isTrustedSender, (input) => workflow.updateCategory(input))
  handle(IPC_CHANNELS.categoriesDeactivate, isTrustedSender, (id) =>
    workflow.deactivateCategory(z.string().uuid().parse(id))
  )
  handle(IPC_CHANNELS.categoriesReactivate, isTrustedSender, (id) =>
    workflow.reactivateCategory(z.string().uuid().parse(id))
  )
  handle(IPC_CHANNELS.categoriesDeleteUnused, isTrustedSender, (id) => {
    workflow.deleteUnusedCategory(z.string().uuid().parse(id))
  })
  handle(IPC_CHANNELS.merchantsList, isTrustedSender, (query) => workflow.listMerchants(query))
  handle(IPC_CHANNELS.merchantsCreate, isTrustedSender, (input) => workflow.createMerchant(input))
  handle(IPC_CHANNELS.merchantsUpdate, isTrustedSender, (input) => workflow.updateMerchant(input))
  handle(IPC_CHANNELS.merchantAliasesList, isTrustedSender, () => workflow.listMerchantAliases())
  handle(IPC_CHANNELS.merchantAliasesCreate, isTrustedSender, (input) =>
    workflow.createMerchantAlias(input)
  )
  handle(IPC_CHANNELS.merchantAliasesUpdate, isTrustedSender, (input) =>
    workflow.updateMerchantAlias(input)
  )
  handle(IPC_CHANNELS.merchantAliasesDeactivate, isTrustedSender, (id) =>
    workflow.deactivateMerchantAlias(z.string().uuid().parse(id))
  )
  handle(IPC_CHANNELS.classificationGet, isTrustedSender, (transactionId) =>
    workflow.getClassification(z.string().uuid().parse(transactionId))
  )
  handle(IPC_CHANNELS.classificationSaveManual, isTrustedSender, (input) =>
    workflow.saveManualClassification(input)
  )
  handle(IPC_CHANNELS.classificationPreviewRule, isTrustedSender, (input) =>
    workflow.previewRule(input)
  )
  handle(IPC_CHANNELS.classificationCreateRule, isTrustedSender, (input) =>
    workflow.createRule(input)
  )
  handle(IPC_CHANNELS.classificationApplyRule, isTrustedSender, (input) =>
    workflow.applyRule(input)
  )
  handle(IPC_CHANNELS.classificationBulkUpdate, isTrustedSender, (input) =>
    workflow.bulkUpdateClassification(input)
  )
  handle(IPC_CHANNELS.rulesList, isTrustedSender, () => workflow.listRules())
  handle(IPC_CHANNELS.rulesActivate, isTrustedSender, (id) =>
    workflow.activateRule(z.string().uuid().parse(id))
  )
  handle(IPC_CHANNELS.rulesDeactivate, isTrustedSender, (id) =>
    workflow.deactivateRule(z.string().uuid().parse(id))
  )
  handle(IPC_CHANNELS.aiGetSettings, isTrustedSender, () => workflow.getAiSettings())
  handle(IPC_CHANNELS.aiSaveOpenAiApiKey, isTrustedSender, (input) =>
    workflow.saveOpenAiApiKey(input)
  )
  handle(IPC_CHANNELS.aiDeleteOpenAiApiKey, isTrustedSender, () => workflow.deleteOpenAiApiKey())
  handle(IPC_CHANNELS.aiUpdateSettings, isTrustedSender, (input) =>
    workflow.updateAiSettings(input)
  )
  handle(IPC_CHANNELS.aiTestConnection, isTrustedSender, () => workflow.testAiConnection())
  handle(IPC_CHANNELS.aiSmartClassify, isTrustedSender, (input) => workflow.smartClassify(input))
  handle(IPC_CHANNELS.aiSmartClassifyImportBatch, isTrustedSender, (input) =>
    workflow.smartClassifyImportBatch(input)
  )
  handle(IPC_CHANNELS.aiListSuggestions, isTrustedSender, (input) =>
    workflow.listAiSuggestions(input)
  )
  handle(IPC_CHANNELS.aiAcceptSuggestion, isTrustedSender, (input) =>
    workflow.acceptAiSuggestion(input)
  )
  handle(IPC_CHANNELS.aiRejectSuggestion, isTrustedSender, (input) =>
    workflow.rejectAiSuggestion(input)
  )
}

function handle<T>(
  channel: string,
  isTrustedSender: TrustedSenderCheck,
  handler: (payload: unknown, event: IpcMainInvokeEvent, secondPayload: unknown) => T | Promise<T>
): void {
  ipcMain.handle(channel, async (event, payload, secondPayload): Promise<ApiResult<Awaited<T>>> => {
    try {
      if (!isTrustedSender(event)) {
        return {
          ok: false,
          error: { code: 'validation_error', message: 'Rejected IPC sender.' }
        }
      }

      return {
        ok: true,
        data: await handler(payload, event, secondPayload)
      }
    } catch (error) {
      return {
        ok: false,
        error: toOperationError(error)
      }
    }
  })
}
