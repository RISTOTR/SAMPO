<script setup lang="ts">
import { transactionColumns } from '../preferences/transaction-columns'
import { useUiPreferencesStore } from '../stores/ui-preferences'
const ui = useUiPreferencesStore()
function closeColumns(event: KeyboardEvent): void {
  const details = event.currentTarget as HTMLDetailsElement
  details.open = false
  details.querySelector('summary')?.focus()
}
</script>

<template>
  <details class="column-selector" @keydown.esc="closeColumns">
    <summary>Columns</summary>
    <div class="column-options" role="group" aria-label="Visible transaction columns">
      <p>Select checkboxes are always visible.</p>
      <div class="column-checkboxes">
        <label v-for="column in transactionColumns" :key="column.id" class="checkbox-label">
          <input
            type="checkbox"
            :checked="ui.isColumnVisible(column.id)"
            @change="ui.toggleColumn(column.id)"
          />
          <span>{{ column.label }}</span>
        </label>
      </div>
      <div class="button-row">
        <button type="button" @click="ui.resetColumns">Reset to default</button>
        <button type="button" class="secondary-button" @click="ui.showAllColumns">Show all</button>
      </div>
    </div>
  </details>
</template>
