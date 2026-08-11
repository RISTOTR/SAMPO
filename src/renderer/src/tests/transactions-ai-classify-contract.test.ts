import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const transactionsView = readFileSync('src/renderer/src/views/TransactionsView.vue', 'utf8')
const aiStore = readFileSync('src/renderer/src/stores/ai.ts', 'utf8')

describe('transactions manual AI classify contract', () => {
  it('wires the Transactions Classify button to selected persisted transaction IDs', () => {
    expect(transactionsView).toContain('const selectedTransactionIds = ref<string[]>([])')
    expect(transactionsView).toContain('v-model="selectedTransactionIds"')
    expect(transactionsView).toContain(':value="transaction.id"')
    expect(transactionsView).toContain('@click="classifySelectedWithAi"')
    expect(transactionsView).toContain(
      'await ai.classifyTransactions(selectedTransactionIds.value)'
    )
    expect(transactionsView).toContain("{{ ai.submitting ? 'Classifying...' : 'Classify' }}")
  })

  it('does not route the row editor button through the AI classify action', () => {
    expect(transactionsView).toContain('@click="openEditor(transaction.id)"')
    expect(transactionsView).toContain('>Edit</button>')
    expect(transactionsView).not.toContain('@click="openEditor(transaction.id)">Classify</button>')
  })

  it('opens the manual editor visibly for the persisted transaction id', () => {
    expect(transactionsView).toContain('async function openEditor(transactionId: string)')
    expect(transactionsView).toContain('await classification.loadClassification(transactionId)')
    expect(transactionsView).toContain('editorTransactionId.value = transactionId')
    expect(transactionsView).toContain('ref="editorPanel"')
    expect(transactionsView).toContain('editorPanel.value?.scrollIntoView')
    expect(transactionsView).toContain("classification.error = 'Transaction could not be loaded.'")
    expect(transactionsView).toContain('editorTransactionId.value = null')
  })

  it('keeps empty, disabled, and missing-key states visible instead of silent', () => {
    expect(aiStore).toContain("message.value = 'No eligible transactions selected.'")
    expect(aiStore).toContain("error.value = 'Enable AI categorisation in Settings first.'")
    expect(aiStore).toContain("error.value = 'Configure an OpenAI API key in Settings first.'")
    expect(aiStore).toContain(
      'message.value = `Classifying ${transactionIds.length} transactions...`'
    )
    expect(aiStore).toContain('window.sampo.ai.smartClassify({ transactionIds })')
  })

  it('filters AI suggestions through the current transaction filters', () => {
    expect(transactionsView).toContain('function currentSuggestionTransactionQuery()')
    expect(transactionsView).toContain('function currentSuggestionListInput()')
    expect(transactionsView).toContain('await ai.loadSuggestions(currentSuggestionListInput())')
    expect(transactionsView).toContain('delete query.limit')
    expect(transactionsView).toContain('delete query.offset')
  })

  it('uses persisted suggestion ids for same-merchant suggestion rows and actions', () => {
    expect(transactionsView).toContain('v-for="suggestion in ai.suggestions"')
    expect(transactionsView).toContain(':key="suggestion.id"')
    expect(transactionsView).toContain('acceptAiSuggestion(suggestion.id')
    expect(transactionsView).toContain('rejectAiSuggestion(suggestion.id)')
    expect(transactionsView).toContain('[sampo-ai-suggestions]')
    expect(aiStore).toContain('[sampo-ai-store]')
    expect(aiStore).toContain('suggestionIdPresent')
    expect(aiStore).toContain('review action started')
    expect(transactionsView).toContain('currentSuggestionListInput()')
    expect(transactionsView).toContain('await ai.acceptSuggestion(suggestionId, options,')
    expect(transactionsView).toContain('await ai.rejectSuggestion(suggestionId,')
  })

  it('disables AI suggestion actions that are not field-actionable', () => {
    expect(transactionsView).toContain(':disabled="ai.submitting || !suggestion.canAcceptCategory"')
    expect(transactionsView).toContain(':disabled="ai.submitting || !suggestion.canAcceptMerchant"')
    expect(transactionsView).toContain(
      '(!suggestion.canAcceptCategory && !suggestion.canAcceptMerchant)'
    )
    expect(aiStore).toContain('Manual category preserved')
    expect(aiStore).toContain('Manual merchant preserved')
    expect(aiStore).toContain('AI suggestion unchanged.')
  })

  it('distinguishes detected display values from authoritative editor selections', () => {
    expect(transactionsView).toContain("merchantDisplay?.displayName ?? 'Unidentified'")
    expect(transactionsView).toContain("categoryDisplay?.displayPath?.join(' / ')")
    expect(transactionsView).toContain('merchantDisplay?.authoritativeId ??')
    expect(transactionsView).toContain('categoryDisplay?.authoritativeId ??')
    expect(transactionsView).toContain('Detected:')
    expect(transactionsView).toContain('classification-note')
  })
})
