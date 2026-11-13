<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReviewItemDto, ReviewListInputDto, ReviewPageDto } from '../../../shared/dtos'
import { unwrapResult, errorMessage } from '../stores/api-result'
import { formatCents, formatDate } from '../formatters'

const props = defineProps<{ query: ReviewListInputDto['transactionQuery']; collapsed: boolean }>()
const emit = defineEmits<{ changed: []; edit: [transactionId: string]; toggle: [] }>()
const page = ref<ReviewPageDto>({ items: [], total: 0 })
const source = ref<'All' | 'Local' | 'AI' | 'Unclassified'>('All')
const offset = ref(0)
const selected = ref<string[]>([])
const busy = ref(false)
const error = ref<string | null>(null)
let loadId = 0
const selectable = computed(() => page.value.items.filter((item) => item.canBulkAccept))
async function load(): Promise<void> {
  const current = ++loadId
  try {
    const next = unwrapResult(
      await window.sampo.review.list({
        transactionQuery: props.query,
        source: source.value,
        offset: offset.value,
        limit: 50
      })
    )
    if (current !== loadId) return
    if (!next.items.length && next.total && offset.value) {
      offset.value = Math.floor((next.total - 1) / 50) * 50
      return
    }
    page.value = next
    selected.value = selected.value.filter((id) =>
      next.items.some((item) => item.transactionId === id && item.canBulkAccept)
    )
    error.value = null
  } catch (caught) {
    if (current === loadId) error.value = errorMessage(caught)
  }
}
watch(
  () => props.query,
  () => {
    offset.value = 0
    selected.value = []
    void load()
  },
  { deep: true }
)
watch(source, () => {
  offset.value = 0
  selected.value = []
  void load()
})
watch(offset, () => {
  selected.value = []
  void load()
})
async function accept(ids: string[], acceptMerchant = true, acceptCategory = true): Promise<void> {
  if (busy.value || !ids.length) return
  await mutate(async () => {
    unwrapResult(
      await window.sampo.review.accept({
        transactionIds: Array.from(ids),
        acceptMerchant,
        acceptCategory
      })
    )
  })
}
async function reject(item: ReviewItemDto): Promise<void> {
  await mutate(async () => {
    unwrapResult(await window.sampo.review.reject({ transactionId: item.transactionId }))
  })
}
async function mutate(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await action()
    selected.value = []
    await load()
    emit('changed')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}
function selectAll(event: Event): void {
  selected.value = (event.target as HTMLInputElement).checked
    ? selectable.value.map((item) => item.transactionId)
    : []
}
defineExpose({ load })
</script>

<template>
  <div class="panel">
    <div class="section-header ai-panel-header">
      <h3>
        Review Suggestions <span class="badge" aria-live="polite">{{ page.total }} remaining</span>
      </h3>
      <button
        type="button"
        class="secondary-button"
        :aria-expanded="!collapsed"
        aria-controls="review-suggestions-content"
        @click="emit('toggle')"
      >
        {{ collapsed ? 'Show' : 'Hide' }} <span class="sr-only">Review Suggestions</span>
      </button>
    </div>
    <div v-show="!collapsed" id="review-suggestions-content">
      <div class="button-row">
        <label
          >Source
          <select v-model="source">
            <option>All</option>
            <option>Local</option>
            <option>AI</option>
            <option>Unclassified</option>
          </select></label
        >
        <button type="button" :disabled="busy" @click="load">Refresh</button>
        <button type="button" :disabled="busy || !selected.length" @click="accept(selected)">
          Accept selected ({{ selected.length }})
        </button>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="!page.total">No classifications awaiting review.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select eligible suggestions on this page"
                  :checked="!!selectable.length && selected.length === selectable.length"
                  :disabled="busy"
                  @change="selectAll"
                />
              </th>
              <th>Description</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in page.items" :key="item.transactionId">
              <td>
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="item.transactionId"
                  :disabled="busy || !item.canBulkAccept"
                  :aria-label="`Select ${item.description}`"
                />
              </td>
              <td>
                {{ item.description
                }}<small class="classification-note"
                  >{{ formatDate(item.date) }} ·
                  {{ formatCents(item.amountCents, item.currency) }}</small
                >
              </td>
              <td>
                {{ item.merchantName ?? 'Unassigned'
                }}<small v-if="item.canAcceptMerchant" class="classification-note"
                  >{{ item.merchantSource
                  }}<template v-if="item.merchantConfidence !== undefined">
                    · {{ Math.round(item.merchantConfidence / 10) }}%</template
                  ></small
                >
              </td>
              <td>
                {{ item.categoryPath?.join(' / ') ?? 'Unclassified'
                }}<small v-if="item.canAcceptCategory" class="classification-note"
                  >{{ item.categorySource
                  }}<template v-if="item.categoryConfidence !== undefined">
                    · {{ Math.round(item.categoryConfidence / 10) }}%</template
                  ></small
                >
              </td>
              <td>
                <p v-if="item.conflict">Conflict — manual review required</p>
                <div class="button-row">
                  <button
                    v-if="item.canAcceptMerchant && item.canAcceptCategory"
                    type="button"
                    :disabled="busy"
                    @click="accept([item.transactionId])"
                  >
                    Accept both
                  </button>
                  <button
                    v-if="item.canAcceptMerchant"
                    type="button"
                    :disabled="busy"
                    @click="accept([item.transactionId], true, false)"
                  >
                    Accept merchant
                  </button>
                  <button
                    v-if="item.canAcceptCategory"
                    type="button"
                    :disabled="busy"
                    @click="accept([item.transactionId], false, true)"
                  >
                    Accept category
                  </button>
                  <button type="button" :disabled="busy" @click="emit('edit', item.transactionId)">
                    Edit
                  </button>
                  <button
                    v-if="item.canAcceptMerchant || item.canAcceptCategory"
                    type="button"
                    class="secondary-button"
                    :disabled="busy"
                    @click="reject(item)"
                  >
                    Reject suggestion
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="page.total > 50" class="button-row">
        <button type="button" :disabled="busy || !offset" @click="offset -= 50">Previous</button>
        <span>{{ offset + 1 }}–{{ Math.min(offset + 50, page.total) }} of {{ page.total }}</span>
        <button type="button" :disabled="busy || offset + 50 >= page.total" @click="offset += 50">
          Next
        </button>
      </div>
    </div>
  </div>
</template>
