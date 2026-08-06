<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel: string
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @keydown.esc="emit('cancel')">
    <section
      class="dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${title.replace(/\s+/g, '-')}-title`"
      tabindex="-1"
    >
      <h3 :id="`${title.replace(/\s+/g, '-')}-title`">{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="button-row">
        <button class="secondary-button" type="button" @click="emit('cancel')">Cancel</button>
        <button class="danger-button" type="button" autofocus @click="emit('confirm')">
          {{ confirmLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
