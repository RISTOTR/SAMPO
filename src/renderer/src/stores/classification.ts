import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  BulkClassificationInputDto,
  CategorisationRuleDto,
  CategoryDto,
  ClassificationProposalDto,
  CreateMerchantAliasInputDto,
  MatchingClassificationSummaryDto,
  MerchantAliasDto,
  MerchantDto,
  RuleApplicationPreviewDto,
  RuleInputDto,
  SaveManualAndConfirmMatchesResultDto,
  SaveManualClassificationInputDto
} from '../../../shared/dtos'
import { errorMessage, unwrapResult } from './api-result'

export const useClassificationStore = defineStore('classification', () => {
  const categories = ref<CategoryDto[]>([])
  const merchants = ref<MerchantDto[]>([])
  const aliases = ref<MerchantAliasDto[]>([])
  const rules = ref<CategorisationRuleDto[]>([])
  const current = ref<ClassificationProposalDto | null>(null)
  const matchingSummary = ref<MatchingClassificationSummaryDto | null>(null)
  const rulePreview = ref<RuleApplicationPreviewDto | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)

  async function loadReference(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [categoryResult, merchantResult, aliasResult, ruleResult] = await Promise.all([
        window.sampo.categories.list(),
        window.sampo.merchants.list({}),
        window.sampo.merchantAliases.list(),
        window.sampo.rules.list()
      ])
      categories.value = unwrapResult(categoryResult)
      merchants.value = unwrapResult(merchantResult)
      aliases.value = unwrapResult(aliasResult)
      rules.value = unwrapResult(ruleResult)
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      loading.value = false
    }
  }

  async function createCategory(input: {
    name: string
    parentId?: string
    sortOrder: number
  }): Promise<void> {
    await submit(async () => {
      await window.sampo.categories.create(input)
      await loadReference()
      message.value = 'Category saved.'
    })
  }

  async function toggleCategory(id: string, active: boolean): Promise<void> {
    await submit(async () => {
      if (active) {
        await window.sampo.categories.reactivate(id)
      } else {
        await window.sampo.categories.deactivate(id)
      }
      await loadReference()
    })
  }

  async function createMerchant(name: string): Promise<void> {
    await submit(async () => {
      await window.sampo.merchants.create({ name })
      await loadReference()
      message.value = 'Merchant saved.'
    })
  }

  async function createAlias(input: CreateMerchantAliasInputDto): Promise<void> {
    await submit(async () => {
      await window.sampo.merchantAliases.create(input)
      await loadReference()
      message.value = 'Alias saved.'
    })
  }

  async function loadClassification(transactionId: string): Promise<void> {
    current.value = unwrapResult(await window.sampo.classification.get(transactionId))
  }

  async function saveManual(input: SaveManualClassificationInputDto): Promise<void> {
    await submit(async () => {
      current.value = unwrapResult(await window.sampo.classification.saveManual(input))
      message.value = 'Classification saved.'
    })
  }

  async function loadMatchingSummary(input: SaveManualClassificationInputDto): Promise<void> {
    matchingSummary.value = unwrapResult(await window.sampo.classification.matchingSummary(input))
  }

  async function saveManualAndConfirmMatches(
    input: SaveManualClassificationInputDto
  ): Promise<SaveManualAndConfirmMatchesResultDto | null> {
    let result: SaveManualAndConfirmMatchesResultDto | null = null
    await submit(async () => {
      result = unwrapResult(await window.sampo.classification.saveManualAndConfirmMatches(input))
      current.value = result.classification
      matchingSummary.value = result.matchingSummary
      message.value = `Classification saved and ${result.confirmedMatchingTransactionCount} matching transactions confirmed.`
    })
    return result
  }

  async function previewRule(input: RuleInputDto): Promise<void> {
    await submit(async () => {
      rulePreview.value = unwrapResult(await window.sampo.classification.previewRule(input))
    })
  }

  async function createRule(input: RuleInputDto): Promise<void> {
    await submit(async () => {
      await window.sampo.classification.createRule(input)
      await loadReference()
      message.value = 'Rule saved.'
    })
  }

  async function applyRule(ruleId: string): Promise<void> {
    await submit(async () => {
      rulePreview.value = unwrapResult(await window.sampo.classification.applyRule({ ruleId }))
      message.value = 'Rule applied.'
    })
  }

  async function toggleRule(id: string, active: boolean): Promise<void> {
    await submit(async () => {
      if (active) {
        await window.sampo.rules.activate(id)
      } else {
        await window.sampo.rules.deactivate(id)
      }
      await loadReference()
    })
  }

  async function bulkUpdate(input: BulkClassificationInputDto): Promise<void> {
    await submit(async () => {
      unwrapResult(await window.sampo.classification.bulkUpdate(input))
      message.value = 'Selected transactions updated.'
    })
  }

  async function submit(action: () => Promise<void>): Promise<void> {
    if (submitting.value) return
    submitting.value = true
    error.value = null
    message.value = null
    try {
      await action()
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      submitting.value = false
    }
  }

  return {
    categories,
    merchants,
    aliases,
    rules,
    current,
    matchingSummary,
    rulePreview,
    loading,
    submitting,
    error,
    message,
    loadReference,
    createCategory,
    toggleCategory,
    createMerchant,
    createAlias,
    loadClassification,
    saveManual,
    loadMatchingSummary,
    saveManualAndConfirmMatches,
    previewRule,
    createRule,
    applyRule,
    toggleRule,
    bulkUpdate
  }
})
