<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
const props = defineProps<{ message: string; error?: boolean; busy?: boolean }>()
const emit = defineEmits<{ dismiss: [] }>()
let timer: ReturnType<typeof setTimeout> | undefined
function clearTimer(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}
function dismiss(): void {
  clearTimer()
  emit('dismiss')
}
watch(
  () => [props.message, props.error, props.busy],
  () => {
    clearTimer()
    if (props.message && !props.error && !props.busy) timer = setTimeout(dismiss, 5000)
  },
  { immediate: true }
)
onBeforeUnmount(clearTimer)
</script>

<template>
  <div
    class="feedback-alert"
    :class="error ? 'error-message' : 'status-message'"
    :role="error ? 'alert' : 'status'"
    :aria-live="error ? 'assertive' : 'polite'"
  >
    <span>{{ message }}</span>
    <button type="button" class="secondary-button" aria-label="Dismiss message" @click="dismiss">
      ×
    </button>
  </div>
</template>
