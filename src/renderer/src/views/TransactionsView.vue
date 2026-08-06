<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { formatCents, formatDate } from '../formatters'
import { useAccountsStore } from '../stores/accounts'
import { useTransactionsStore } from '../stores/transactions'
import type { TransactionListQueryDto } from '../../../shared/dtos'

const accounts = useAccountsStore()
const transactions = useTransactionsStore()
const filters = reactive({
  accountId: '',
  dateFrom: '',
  dateTo: '',
  transactionType: '',
  pending: '',
  excludedFromSpending: '',
  sortBy: 'transactionDate' as 'transactionDate' | 'amount',
  sortDirection: 'desc' as 'asc' | 'desc',
  offset: 0
})

const currentPage = computed(
  () => Math.floor(transactions.page.offset / transactions.page.limit) + 1
)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(transactions.page.total / transactions.page.limit))
)

onMounted(async () => {
  await Promise.all([accounts.load(), loadTransactions()])
})

async function loadTransactions(): Promise<void> {
  const transactionType = filters.transactionType
    ? (filters.transactionType as NonNullable<TransactionListQueryDto['transactionType']>)
    : undefined

  await transactions.load({
    accountId: filters.accountId || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    transactionType,
    pending: filters.pending === '' ? undefined : filters.pending === 'true',
    excludedFromSpending:
      filters.excludedFromSpending === '' ? undefined : filters.excludedFromSpending === 'true',
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
    limit: 50,
    offset: filters.offset
  })
}

async function applyFilters(): Promise<void> {
  filters.offset = 0
  await loadTransactions()
}

async function nextPage(): Promise<void> {
  filters.offset += transactions.page.limit
  await loadTransactions()
}

async function previousPage(): Promise<void> {
  filters.offset = Math.max(0, filters.offset - transactions.page.limit)
  await loadTransactions()
}
</script>

<template>
  <section class="view-stack">
    <p v-if="transactions.error" class="error-message" aria-live="polite">
      {{ transactions.error }}
    </p>

    <div class="panel">
      <h3>Filters</h3>
      <form class="form-grid" @submit.prevent="applyFilters">
        <div class="form-field">
          <label for="filter-account">Account</label>
          <select id="filter-account" v-model="filters.accountId">
            <option value="">All accounts</option>
            <option v-for="account in accounts.accounts" :key="account.id" :value="account.id">
              {{ account.name }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-from">Date from</label>
          <input id="filter-from" v-model="filters.dateFrom" type="date" />
        </div>
        <div class="form-field">
          <label for="filter-to">Date to</label>
          <input id="filter-to" v-model="filters.dateTo" type="date" />
        </div>
        <div class="form-field">
          <label for="filter-type">Type</label>
          <select id="filter-type" v-model="filters.transactionType">
            <option value="">All types</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="refund">Refund</option>
            <option value="card_settlement">Card settlement</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-pending">Pending</label>
          <select id="filter-pending" v-model="filters.pending">
            <option value="">All</option>
            <option value="false">Completed</option>
            <option value="true">Pending</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-excluded">Spending</label>
          <select id="filter-excluded" v-model="filters.excludedFromSpending">
            <option value="">All</option>
            <option value="false">Included</option>
            <option value="true">Excluded</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-sort">Sort</label>
          <select id="filter-sort" v-model="filters.sortBy">
            <option value="transactionDate">Transaction date</option>
            <option value="amount">Amount</option>
          </select>
        </div>
        <div class="form-field">
          <label for="filter-direction">Direction</label>
          <select id="filter-direction" v-model="filters.sortDirection">
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
        <button type="submit" :disabled="transactions.loading">Apply filters</button>
      </form>
    </div>

    <div class="panel">
      <h3>Transactions</h3>
      <p v-if="transactions.page.items.length === 0">No transactions match the selected filters.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Value date</th>
              <th>Description</th>
              <th>Account</th>
              <th class="numeric">Amount</th>
              <th class="numeric">Balance</th>
              <th>Type</th>
              <th>Pending</th>
              <th>Spending</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="transaction in transactions.page.items" :key="transaction.id">
              <td>{{ formatDate(transaction.transactionDate) }}</td>
              <td>{{ formatDate(transaction.valueDate) }}</td>
              <td>{{ transaction.description }}</td>
              <td>{{ transaction.accountName }}</td>
              <td class="numeric">
                {{ formatCents(transaction.amountCents, transaction.currency) }}
              </td>
              <td class="numeric">
                {{
                  transaction.balanceCents === undefined
                    ? ''
                    : formatCents(transaction.balanceCents, transaction.currency)
                }}
              </td>
              <td>{{ transaction.transactionType }}</td>
              <td>{{ transaction.isPending ? 'Pending' : 'Completed' }}</td>
              <td>{{ transaction.excludedFromSpending ? 'Excluded' : 'Included' }}</td>
              <td>{{ transaction.reviewStatus }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="button-row">
        <button type="button" :disabled="filters.offset === 0" @click="previousPage">
          Previous
        </button>
        <span
          >Page {{ currentPage }} of {{ totalPages }} ·
          {{ transactions.page.total }} transactions</span
        >
        <button
          type="button"
          :disabled="filters.offset + transactions.page.limit >= transactions.page.total"
          @click="nextPage"
        >
          Next
        </button>
      </div>
    </div>
  </section>
</template>
