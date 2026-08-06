export const IPC_CHANNELS = {
  getAppInfo: 'sampo:app-info:get',
  overviewGetStats: 'sampo:overview:get-stats',
  accountsList: 'sampo:accounts:list',
  accountsCreate: 'sampo:accounts:create',
  accountsUpdate: 'sampo:accounts:update',
  accountsDeleteUnused: 'sampo:accounts:delete-unused',
  importsSelectAndInspect: 'sampo:imports:select-and-inspect',
  importsCommitPreview: 'sampo:imports:commit-preview',
  importsDiscardPreview: 'sampo:imports:discard-preview',
  importsList: 'sampo:imports:list',
  importsRollback: 'sampo:imports:rollback',
  transactionsList: 'sampo:transactions:list',
  reconciliationListSettlements: 'sampo:reconciliation:list-settlements',
  reconciliationFindCandidates: 'sampo:reconciliation:find-candidates',
  reconciliationPreview: 'sampo:reconciliation:preview',
  reconciliationCommit: 'sampo:reconciliation:commit',
  reconciliationReverse: 'sampo:reconciliation:reverse'
} as const
