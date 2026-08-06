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
