<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { formatCents, formatDate, formatDateTime, sourceLabel } from '../formatters'
import { useAccountsStore } from '../stores/accounts'
import { useImportsStore } from '../stores/imports'
import { useReconciliationStore } from '../stores/reconciliation'
import { useTransactionsStore } from '../stores/transactions'

const accounts = useAccountsStore()
const imports = useImportsStore()
const reconciliation = useReconciliationStore()
const transactions = useTransactionsStore()
const selectedAccountId = ref('')
const selectedSettlementId = ref('')
const selectedCandidateBatchId = ref('')
const pendingRollbackId = ref<string | null>(null)
const pendingCommitImport = ref(false)
const pendingCommitReconciliation = ref(false)
const pendingReverseSettlementId = ref<string | null>(null)

const importableAccounts = computed(() =>
  accounts.accounts.filter(
    (account) => account.kind === 'current' || account.kind === 'credit_card'
  )
)
const selectedCandidate = computed(() =>
  reconciliation.candidates.find(
    (candidate) => candidate.visaImportBatchId === selectedCandidateBatchId.value
  )
)

onMounted(async () => {
  await Promise.all([accounts.load(), imports.loadHistory(), reconciliation.loadSettlements()])
  selectedAccountId.value = importableAccounts.value[0]?.id ?? ''
})

async function inspect(): Promise<void> {
  if (!selectedAccountId.value) return
  await imports.selectAndInspect(selectedAccountId.value)
}

async function commitImport(): Promise<void> {
  pendingCommitImport.value = false
  if (await imports.commitPreview()) {
    await Promise.all([transactions.load(), reconciliation.loadSettlements()])
  }
}

async function rollbackImport(): Promise<void> {
  const id = pendingRollbackId.value
  pendingRollbackId.value = null
  if (!id) return
  await imports.rollback(id)
  await Promise.all([transactions.load(), reconciliation.loadSettlements()])
}

async function chooseSettlement(id: string): Promise<void> {
  selectedSettlementId.value = id
  selectedCandidateBatchId.value = ''
  await reconciliation.findCandidates(id)
}

async function chooseCandidate(batchId: string): Promise<void> {
  selectedCandidateBatchId.value = batchId
  if (selectedSettlementId.value) {
    await reconciliation.loadPreview(selectedSettlementId.value, batchId)
  }
}

async function commitReconciliation(): Promise<void> {
  pendingCommitReconciliation.value = false
  if (!selectedSettlementId.value || !selectedCandidateBatchId.value) return
  const result = await reconciliation.commit(
    selectedSettlementId.value,
    selectedCandidateBatchId.value
  )
  if (result) {
    selectedSettlementId.value = ''
    selectedCandidateBatchId.value = ''
    reconciliation.candidates = []
    reconciliation.preview = null
    await Promise.all([imports.loadHistory(), transactions.load()])
  }
}

async function reverseReconciliation(): Promise<void> {
  const settlementId = pendingReverseSettlementId.value
  pendingReverseSettlementId.value = null
  if (!settlementId) return
  await reconciliation.reverse(settlementId)
  await Promise.all([imports.loadHistory(), transactions.load()])
}
</script>

<template>
  <section class="view-stack">
    <p v-if="imports.message" class="status-message" aria-live="polite">{{ imports.message }}</p>
    <p v-if="imports.error" class="error-message" aria-live="polite">{{ imports.error }}</p>
    <p v-if="reconciliation.error" class="error-message" aria-live="polite">
      {{ reconciliation.error }}
    </p>

    <div class="panel">
      <h3>New import</h3>
      <div v-if="importableAccounts.length === 0">
        <p>Account setup is required before importing statements.</p>
        <RouterLink to="/settings">Open Settings</RouterLink>
      </div>
      <div v-else class="form-grid">
        <div class="form-field">
          <label for="import-account">Account</label>
          <select id="import-account" v-model="selectedAccountId">
            <option v-for="account in importableAccounts" :key="account.id" :value="account.id">
              {{ account.name }} ·
              {{ account.kind === 'credit_card' ? 'Credit card' : 'Current account' }}
            </option>
          </select>
        </div>
        <button type="button" :disabled="imports.submitting" @click="inspect">
          Select statement file
        </button>
      </div>
    </div>

    <div v-if="imports.preview" class="panel">
      <h3>Import preview</h3>
      <dl class="summary-grid">
        <div>
          <dt>Filename</dt>
          <dd>{{ imports.preview.sourceFileName }}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{{ sourceLabel(imports.preview.sourceKind) }}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{{ imports.preview.inspection.completedCount }}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{{ imports.preview.inspection.pendingCount }}</dd>
        </div>
        <div>
          <dt>Invalid rows</dt>
          <dd>{{ imports.preview.inspection.invalidRowCount }}</dd>
        </div>
        <div>
          <dt>Warnings</dt>
          <dd>{{ imports.preview.inspection.warningCount }}</dd>
        </div>
        <div v-if="imports.preview.inspection.details">
          <dt>PDF pages</dt>
          <dd>{{ imports.preview.inspection.details.pageCount }}</dd>
        </div>
        <div v-if="imports.preview.inspection.details">
          <dt>Balance validation</dt>
          <dd>
            {{ imports.preview.inspection.details.balanceContinuityPassed ? 'Passed' : 'Failed' }}
          </dd>
        </div>
      </dl>

      <div v-if="imports.preview.inspection.warnings.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Warning</th>
              <th>Field</th>
              <th>Blocking</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="warning in imports.preview.inspection.warnings"
              :key="`${warning.code}-${warning.field}`"
            >
              <td>{{ warning.message }}</td>
              <td>{{ warning.field ?? '' }}</td>
              <td>{{ warning.blocking ? 'Yes' : 'No' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4>Transactions</h4>
      <div class="table-wrap preview-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th class="numeric">Amount</th>
              <th>Type</th>
              <th>Status</th>
              <th class="numeric">Balance</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="transaction in imports.preview.transactions"
              :key="transaction.sourceRowIndex"
            >
              <td>{{ formatDate(transaction.transactionDate) }}</td>
              <td>{{ transaction.description }}</td>
              <td class="numeric">
                {{ formatCents(transaction.amountCents, transaction.currency) }}
              </td>
              <td>{{ transaction.transactionType }}</td>
              <td>
                <span :class="['badge', transaction.isPending ? 'badge-warning' : 'badge-good']">{{
                  transaction.isPending ? 'Pending' : 'Completed'
                }}</span>
              </td>
              <td class="numeric">
                {{
                  transaction.balanceCents === undefined
                    ? ''
                    : formatCents(transaction.balanceCents, transaction.currency)
                }}
              </td>
              <td>{{ transaction.reviewStatus }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="button-row preview-actions">
        <button
          type="button"
          :disabled="!imports.preview.inspection.canImport || imports.submitting"
          @click="pendingCommitImport = true"
        >
          Import transactions
        </button>
        <button class="secondary-button" type="button" @click="imports.discardPreview">
          Cancel preview
        </button>
      </div>
    </div>

    <div class="panel">
      <h3>Reconciliation review</h3>
      <div class="split-grid">
        <div>
          <h4>Card settlements</h4>
          <p v-if="reconciliation.settlements.length === 0">No committed card settlements.</p>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th class="numeric">Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="settlement in reconciliation.settlements" :key="settlement.id">
                  <td>{{ formatDate(settlement.transactionDate) }}</td>
                  <td>{{ settlement.accountName }}</td>
                  <td class="numeric">
                    {{ formatCents(settlement.amountCents, settlement.currency) }}
                  </td>
                  <td>{{ settlement.reconciled ? 'Reconciled' : settlement.reviewStatus }}</td>
                  <td>
                    <button
                      v-if="!settlement.reconciled"
                      type="button"
                      @click="chooseSettlement(settlement.id)"
                    >
                      Find candidates
                    </button>
                    <button
                      v-else
                      class="secondary-button"
                      type="button"
                      @click="pendingReverseSettlementId = settlement.id"
                    >
                      Reverse
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h4>Candidate batches</h4>
          <p v-if="!selectedSettlementId">Select a settlement to find candidates.</p>
          <p v-else-if="reconciliation.candidates.length === 0">No candidates found.</p>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Visa account</th>
                  <th>Period</th>
                  <th>Completed</th>
                  <th>Pending</th>
                  <th class="numeric">Difference</th>
                  <th>Match</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="candidate in reconciliation.candidates"
                  :key="candidate.visaImportBatchId"
                >
                  <td>{{ candidate.visaAccountName }}</td>
                  <td>
                    {{ formatDate(candidate.statementPeriodStart) }}–{{
                      formatDate(candidate.statementPeriodEnd)
                    }}
                  </td>
                  <td>{{ candidate.completedTransactionCount }}</td>
                  <td>{{ candidate.pendingTransactionCount }}</td>
                  <td class="numeric">{{ formatCents(candidate.differenceCents) }}</td>
                  <td>
                    {{
                      candidate.exactAmountMatch && candidate.dateOrderValid ? 'Exact' : 'Review'
                    }}
                  </td>
                  <td>
                    <button type="button" @click="chooseCandidate(candidate.visaImportBatchId)">
                      Preview
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="reconciliation.preview" class="panel">
            <h4>Reconciliation preview</h4>
            <p>
              Completed {{ reconciliation.preview.completedVisaTransactionCount }}, pending ignored
              {{ reconciliation.preview.ignoredPendingTransactionCount }}, difference
              {{ formatCents(reconciliation.preview.differenceCents) }}.
            </p>
            <p v-if="selectedCandidate?.warnings.length" class="status-message">
              Candidate warnings:
              {{ selectedCandidate.warnings.map((warning) => warning.code).join(', ') }}
            </p>
            <button
              type="button"
              :disabled="!reconciliation.preview.canCommit || reconciliation.submitting"
              @click="pendingCommitReconciliation = true"
            >
              Reconcile selected batch
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>Import history</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Source</th>
              <th>Account</th>
              <th>Period</th>
              <th>Status</th>
              <th>Transactions</th>
              <th>Committed</th>
              <th>Rolled back</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in imports.history" :key="batch.id">
              <td>{{ batch.sourceFileName }}</td>
              <td>{{ sourceLabel(batch.sourceKind) }}</td>
              <td>{{ batch.accountName }}</td>
              <td>
                {{ formatDate(batch.statementPeriodStart) }}–{{
                  formatDate(batch.statementPeriodEnd)
                }}
              </td>
              <td>{{ batch.status }}</td>
              <td>{{ batch.transactionCount }}</td>
              <td>{{ formatDateTime(batch.committedAt) }}</td>
              <td>{{ formatDateTime(batch.rolledBackAt) }}</td>
              <td>
                <button
                  v-if="batch.status === 'committed'"
                  type="button"
                  :disabled="batch.rollbackBlockedByReconciliation"
                  @click="pendingRollbackId = batch.id"
                >
                  Roll back
                </button>
                <span v-if="batch.rollbackBlockedByReconciliation" class="badge badge-warning"
                  >Reverse reconciliation first</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingCommitImport"
      title="Import transactions"
      message="Commit this preview as an all-or-nothing import?"
      confirm-label="Import transactions"
      @cancel="pendingCommitImport = false"
      @confirm="commitImport"
    />
    <ConfirmDialog
      :open="Boolean(pendingRollbackId)"
      title="Roll back import"
      message="Rollback removes imported transactions and keeps the import history record."
      confirm-label="Roll back import"
      @cancel="pendingRollbackId = null"
      @confirm="rollbackImport"
    />
    <ConfirmDialog
      :open="pendingCommitReconciliation"
      title="Reconcile settlement"
      message="Create settlement links and exclude the account settlement from spending?"
      confirm-label="Reconcile"
      @cancel="pendingCommitReconciliation = false"
      @confirm="commitReconciliation"
    />
    <ConfirmDialog
      :open="Boolean(pendingReverseSettlementId)"
      title="Reverse reconciliation"
      message="The account settlement will count as spending again until reconciled."
      confirm-label="Reverse reconciliation"
      @cancel="pendingReverseSettlementId = null"
      @confirm="reverseReconciliation"
    />
  </section>
</template>
