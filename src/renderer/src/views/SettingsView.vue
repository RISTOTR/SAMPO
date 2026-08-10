<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useAccountsStore } from '../stores/accounts'
import { useAiStore } from '../stores/ai'
import { useClassificationStore } from '../stores/classification'

const accounts = useAccountsStore()
const ai = useAiStore()
const classification = useClassificationStore()
const createForm = reactive({ name: '', kind: 'current' as const, institution: '' })
const categoryForm = reactive({ name: '', parentId: '', sortOrder: 0 })
const merchantForm = reactive({ name: '' })
const aliasForm = reactive({
  merchantId: '',
  matchKind: 'exact' as const,
  pattern: '',
  priority: 0
})
const ruleForm = reactive({
  name: '',
  merchantId: '',
  descriptionMatchKind: 'contains' as const,
  descriptionPattern: '',
  categoryId: '',
  usageType: 'unspecified' as const,
  costBehaviour: 'unspecified' as const,
  necessity: 'unspecified' as const,
  priority: 0
})
const editing = reactive<Record<string, { name: string; institution: string }>>({})
const pendingDeleteId = ref<string | null>(null)
const apiKeyInput = ref('')
const aiForm = reactive({
  aiEnabled: false,
  classifyNewImports: true,
  allowWebLookup: false,
  autoAcceptHighConfidence: false,
  country: '',
  city: ''
})

onMounted(async () => {
  await Promise.all([accounts.load(), classification.loadReference(), ai.loadSettings()])
  syncAiForm()
})

function syncAiForm(): void {
  if (!ai.settings) return
  aiForm.aiEnabled = ai.settings.aiEnabled
  aiForm.classifyNewImports = ai.settings.classifyNewImports
  aiForm.allowWebLookup = ai.settings.allowWebLookup
  aiForm.autoAcceptHighConfidence = ai.settings.autoAcceptHighConfidence
  aiForm.country = ai.settings.country ?? ''
  aiForm.city = ai.settings.city ?? ''
}

async function createAccount(): Promise<void> {
  const ok = await accounts.create({
    name: createForm.name,
    kind: createForm.kind,
    institution: createForm.institution || undefined,
    currency: 'EUR'
  })

  if (ok) {
    createForm.name = ''
    createForm.institution = ''
  }
}

async function saveAccount(id: string): Promise<void> {
  const draft = editing[id]

  if (!draft) return

  await accounts.update({
    id,
    name: draft.name,
    institution: draft.institution || undefined
  })
}

function draftFor(account: { id: string; name: string; institution?: string }): {
  name: string
  institution: string
} {
  editing[account.id] ??= {
    name: account.name,
    institution: account.institution ?? ''
  }

  return editing[account.id]
}

async function confirmDelete(): Promise<void> {
  if (!pendingDeleteId.value) return
  await accounts.deleteUnused(pendingDeleteId.value)
  pendingDeleteId.value = null
}

async function createCategory(): Promise<void> {
  await classification.createCategory({
    name: categoryForm.name,
    parentId: categoryForm.parentId || undefined,
    sortOrder: categoryForm.sortOrder
  })
  categoryForm.name = ''
  categoryForm.parentId = ''
}

async function createMerchant(): Promise<void> {
  await classification.createMerchant(merchantForm.name)
  merchantForm.name = ''
}

async function createAlias(): Promise<void> {
  if (!aliasForm.merchantId) return
  await classification.createAlias({
    merchantId: aliasForm.merchantId,
    matchKind: aliasForm.matchKind,
    pattern: aliasForm.pattern,
    priority: aliasForm.priority
  })
  aliasForm.pattern = ''
}

async function previewRule(): Promise<void> {
  await classification.previewRule({
    name: ruleForm.name,
    merchantId: ruleForm.merchantId || undefined,
    descriptionMatchKind: ruleForm.descriptionPattern ? ruleForm.descriptionMatchKind : undefined,
    descriptionPattern: ruleForm.descriptionPattern || undefined,
    categoryId: ruleForm.categoryId || undefined,
    usageType: ruleForm.usageType,
    costBehaviour: ruleForm.costBehaviour,
    necessity: ruleForm.necessity,
    priority: ruleForm.priority
  })
}

async function createRule(): Promise<void> {
  await classification.createRule({
    name: ruleForm.name,
    merchantId: ruleForm.merchantId || undefined,
    descriptionMatchKind: ruleForm.descriptionPattern ? ruleForm.descriptionMatchKind : undefined,
    descriptionPattern: ruleForm.descriptionPattern || undefined,
    categoryId: ruleForm.categoryId || undefined,
    usageType: ruleForm.usageType,
    costBehaviour: ruleForm.costBehaviour,
    necessity: ruleForm.necessity,
    priority: ruleForm.priority
  })
  ruleForm.name = ''
  ruleForm.descriptionPattern = ''
}

async function saveAiSettings(): Promise<void> {
  await ai.updateSettings({
    aiEnabled: aiForm.aiEnabled,
    classifyNewImports: aiForm.classifyNewImports,
    allowWebLookup: aiForm.allowWebLookup,
    autoAcceptHighConfidence: aiForm.autoAcceptHighConfidence,
    country: aiForm.country || undefined,
    city: aiForm.city || undefined
  })
  syncAiForm()
}

async function saveApiKey(): Promise<void> {
  if (!apiKeyInput.value) return
  await ai.saveApiKey(apiKeyInput.value)
  apiKeyInput.value = ''
  syncAiForm()
}
</script>

<template>
  <section class="view-stack">
    <div class="panel">
      <h3>AI categorisation</h3>
      <p>
        Smart suggestions are optional. API keys are stored locally and transaction descriptors are
        sent only when you run AI classification.
      </p>

      <p v-if="ai.error" class="error-message" aria-live="polite">{{ ai.error }}</p>
      <p v-if="ai.message" class="status-message" aria-live="polite">{{ ai.message }}</p>

      <form class="form-grid" @submit.prevent="saveApiKey">
        <div class="form-field">
          <label for="openai-key">OpenAI API key</label>
          <input
            id="openai-key"
            v-model="apiKeyInput"
            type="password"
            autocomplete="new-password"
            placeholder="Configured keys are never displayed"
          />
        </div>
        <div class="form-field">
          <label>Key status</label>
          <span>{{ ai.settings?.keyConfigured ? 'Configured' : 'Not configured' }}</span>
        </div>
        <button type="submit" :disabled="ai.submitting || !apiKeyInput">Save key</button>
        <button
          class="secondary-button"
          type="button"
          :disabled="ai.submitting"
          @click="ai.deleteApiKey"
        >
          Delete key
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="ai.submitting"
          @click="ai.testConnection"
        >
          Test connection
        </button>
      </form>

      <form class="form-grid" @submit.prevent="saveAiSettings">
        <label class="form-field">
          <span>AI enabled</span>
          <input v-model="aiForm.aiEnabled" type="checkbox" />
        </label>
        <label class="form-field">
          <span>Classify new imports</span>
          <input v-model="aiForm.classifyNewImports" type="checkbox" />
        </label>
        <label class="form-field">
          <span>Allow web lookup</span>
          <input v-model="aiForm.allowWebLookup" type="checkbox" />
        </label>
        <label class="form-field">
          <span>Auto-accept high confidence</span>
          <input v-model="aiForm.autoAcceptHighConfidence" type="checkbox" />
        </label>
        <div class="form-field">
          <label for="ai-country">Country context</label>
          <input id="ai-country" v-model="aiForm.country" autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="ai-city">City context</label>
          <input id="ai-city" v-model="aiForm.city" autocomplete="off" />
        </div>
        <div class="form-field">
          <label>Bulk model</label>
          <span>{{ ai.settings?.models.bulkClassificationModel ?? '' }}</span>
        </div>
        <div class="form-field">
          <label>Web model</label>
          <span>{{ ai.settings?.models.webLookupModel ?? '' }}</span>
        </div>
        <button type="submit" :disabled="ai.submitting">Save AI settings</button>
      </form>
    </div>

    <div class="panel">
      <h3>Accounts</h3>
      <p>
        Create local account records for imports. Sampo does not collect IBANs, card numbers, or
        credentials.
      </p>

      <form class="form-grid" @submit.prevent="createAccount">
        <div class="form-field">
          <label for="account-name">Display name</label>
          <input id="account-name" v-model="createForm.name" required autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="account-kind">Type</label>
          <select id="account-kind" v-model="createForm.kind">
            <option value="current">Current account</option>
            <option value="credit_card">Credit card</option>
          </select>
        </div>
        <div class="form-field">
          <label for="account-institution">Institution</label>
          <input id="account-institution" v-model="createForm.institution" autocomplete="off" />
        </div>
        <button type="submit" :disabled="accounts.loading">Create account</button>
      </form>
    </div>

    <p v-if="accounts.error" class="error-message" aria-live="polite">{{ accounts.error }}</p>
    <p v-if="classification.error" class="error-message" aria-live="polite">
      {{ classification.error }}
    </p>
    <p v-if="classification.message" class="status-message" aria-live="polite">
      {{ classification.message }}
    </p>

    <div class="panel">
      <h3>Existing accounts</h3>
      <p v-if="accounts.accounts.length === 0">No accounts configured yet.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Institution</th>
              <th>Currency</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts.accounts" :key="account.id">
              <td>
                <label class="form-field">
                  <span class="sr-only">Account name</span>
                  <input v-model="draftFor(account).name" />
                </label>
              </td>
              <td>{{ account.kind === 'credit_card' ? 'Credit card' : 'Current account' }}</td>
              <td><input v-model="draftFor(account).institution" aria-label="Institution" /></td>
              <td>{{ account.currency }}</td>
              <td>
                <div class="button-row">
                  <button type="button" @click="saveAccount(account.id)">Save</button>
                  <button class="danger-button" type="button" @click="pendingDeleteId = account.id">
                    Delete unused
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Categories</h3>
      <form class="form-grid" @submit.prevent="createCategory">
        <div class="form-field">
          <label for="category-name">Name</label>
          <input id="category-name" v-model="categoryForm.name" required autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="category-parent">Parent</label>
          <select id="category-parent" v-model="categoryForm.parentId">
            <option value="">Top level</option>
            <option
              v-for="category in classification.categories.filter((item) => !item.parentId)"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="category-order">Order</label>
          <input id="category-order" v-model.number="categoryForm.sortOrder" type="number" />
        </div>
        <button type="submit" :disabled="classification.submitting">Create category</button>
      </form>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Parent</th>
              <th>Type</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="category in classification.categories" :key="category.id">
              <td>{{ category.name }}</td>
              <td>
                {{
                  classification.categories.find((parent) => parent.id === category.parentId)
                    ?.name ?? ''
                }}
              </td>
              <td>{{ category.isSystem ? 'Default' : 'User' }}</td>
              <td>{{ category.isActive ? 'Active' : 'Inactive' }}</td>
              <td>
                <button
                  type="button"
                  @click="classification.toggleCategory(category.id, !category.isActive)"
                >
                  {{ category.isActive ? 'Deactivate' : 'Reactivate' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Merchants and aliases</h3>
      <form class="form-grid" @submit.prevent="createMerchant">
        <div class="form-field">
          <label for="merchant-name">Merchant name</label>
          <input id="merchant-name" v-model="merchantForm.name" required autocomplete="off" />
        </div>
        <button type="submit" :disabled="classification.submitting">Create merchant</button>
      </form>
      <form class="form-grid" @submit.prevent="createAlias">
        <div class="form-field">
          <label for="alias-merchant">Merchant</label>
          <select id="alias-merchant" v-model="aliasForm.merchantId" required>
            <option value="">Select merchant</option>
            <option
              v-for="merchant in classification.merchants"
              :key="merchant.id"
              :value="merchant.id"
            >
              {{ merchant.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="alias-kind">Match</label>
          <select id="alias-kind" v-model="aliasForm.matchKind">
            <option value="exact">Exact</option>
            <option value="starts_with">Starts with</option>
            <option value="contains">Contains</option>
          </select>
        </div>
        <div class="form-field">
          <label for="alias-pattern">Pattern</label>
          <input id="alias-pattern" v-model="aliasForm.pattern" required autocomplete="off" />
        </div>
        <button type="submit" :disabled="classification.submitting">Create alias</button>
      </form>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Match</th>
              <th>Pattern</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="alias in classification.aliases" :key="alias.id">
              <td>
                {{
                  classification.merchants.find((merchant) => merchant.id === alias.merchantId)
                    ?.name ?? 'Unknown'
                }}
              </td>
              <td>{{ alias.matchKind }}</td>
              <td>{{ alias.pattern }}</td>
              <td>{{ alias.priority }}</td>
              <td>{{ alias.isActive ? 'Active' : 'Inactive' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Categorisation rules</h3>
      <form class="form-grid" @submit.prevent="previewRule">
        <div class="form-field">
          <label for="rule-name">Rule name</label>
          <input id="rule-name" v-model="ruleForm.name" required autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="rule-merchant">Merchant condition</label>
          <select id="rule-merchant" v-model="ruleForm.merchantId">
            <option value="">No merchant condition</option>
            <option
              v-for="merchant in classification.merchants"
              :key="merchant.id"
              :value="merchant.id"
            >
              {{ merchant.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="rule-match">Description match</label>
          <select id="rule-match" v-model="ruleForm.descriptionMatchKind">
            <option value="exact">Exact</option>
            <option value="starts_with">Starts with</option>
            <option value="contains">Contains</option>
          </select>
        </div>
        <div class="form-field">
          <label for="rule-pattern">Description pattern</label>
          <input id="rule-pattern" v-model="ruleForm.descriptionPattern" autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="rule-category">Category</label>
          <select id="rule-category" v-model="ruleForm.categoryId">
            <option value="">No category</option>
            <option
              v-for="category in classification.categories.filter((item) => item.isActive)"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="rule-usage">Usage</label>
          <select id="rule-usage" v-model="ruleForm.usageType">
            <option value="unspecified">Unspecified</option>
            <option value="personal">Personal</option>
            <option value="business">Business</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
        <div class="form-field">
          <label for="rule-cost">Cost</label>
          <select id="rule-cost" v-model="ruleForm.costBehaviour">
            <option value="unspecified">Unspecified</option>
            <option value="fixed">Fixed</option>
            <option value="variable">Variable</option>
          </select>
        </div>
        <div class="form-field">
          <label for="rule-necessity">Necessity</label>
          <select id="rule-necessity" v-model="ruleForm.necessity">
            <option value="unspecified">Unspecified</option>
            <option value="essential">Essential</option>
            <option value="discretionary">Discretionary</option>
          </select>
        </div>
        <button type="submit" :disabled="classification.submitting">Preview matches</button>
        <button type="button" :disabled="classification.submitting" @click="createRule">
          Create rule
        </button>
      </form>
      <p v-if="classification.rulePreview" class="status-message">
        Matches {{ classification.rulePreview.matchCount }}, manual preserved
        {{ classification.rulePreview.manualPreservedCount }}, ambiguous
        {{ classification.rulePreview.ambiguousCount }}.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in classification.rules" :key="rule.id">
              <td>{{ rule.name }}</td>
              <td>{{ rule.priority }}</td>
              <td>{{ rule.isActive ? 'Active' : 'Inactive' }}</td>
              <td>
                <div class="button-row">
                  <button type="button" @click="classification.applyRule(rule.id)">
                    Apply historically
                  </button>
                  <button type="button" @click="classification.toggleRule(rule.id, !rule.isActive)">
                    {{ rule.isActive ? 'Deactivate' : 'Activate' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ConfirmDialog
      :open="Boolean(pendingDeleteId)"
      title="Delete account"
      message="Delete this account only if it has no imports or transactions."
      confirm-label="Delete account"
      @cancel="pendingDeleteId = null"
      @confirm="confirmDelete"
    />
  </section>
</template>
