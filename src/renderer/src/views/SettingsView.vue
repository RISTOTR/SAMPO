<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useAccountsStore } from '../stores/accounts'

const accounts = useAccountsStore()
const createForm = reactive({ name: '', kind: 'current' as const, institution: '' })
const editing = reactive<Record<string, { name: string; institution: string }>>({})
const pendingDeleteId = ref<string | null>(null)

onMounted(() => {
  void accounts.load()
})

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
</script>

<template>
  <section class="view-stack">
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
