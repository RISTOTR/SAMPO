<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { appInfoSchema, type AppInfo } from './schemas/app-info'

const appInfo = ref<AppInfo | null>(null)
const appInfoError = ref<string | null>(null)
const route = useRoute()

const navigationItems = [
  { path: '/', label: 'Overview' },
  { path: '/imports', label: 'Imports' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/subscriptions', label: 'Subscriptions' },
  { path: '/settings', label: 'Settings' }
]

const currentSection = computed(() => {
  return navigationItems.find((item) => item.path === route.path)?.label ?? 'Sampo'
})

onMounted(async () => {
  try {
    appInfo.value = appInfoSchema.parse(await window.sampo.getAppInfo())
  } catch {
    appInfoError.value = 'Version unavailable'
  }
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Primary navigation">
      <div class="brand">
        <h1>Sampo</h1>
        <p>Local-first personal finance</p>
      </div>

      <nav class="navigation">
        <RouterLink
          v-for="item in navigationItems"
          :key="item.path"
          :to="item.path"
          class="navigation-link"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="app-version" aria-live="polite">
        <span v-if="appInfo">Version {{ appInfo.version }}</span>
        <span v-else>{{ appInfoError ?? 'Loading version' }}</span>
      </div>
    </aside>

    <main class="content">
      <header class="content-header">
        <p>Current section</p>
        <h2>{{ currentSection }}</h2>
      </header>

      <RouterView />
    </main>
  </div>
</template>
