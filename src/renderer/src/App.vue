<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { appInfoSchema, type AppInfo } from './schemas/app-info'

import { useUiPreferencesStore } from './stores/ui-preferences'

const ui = useUiPreferencesStore()
const appInfo = ref<AppInfo | null>(null)
const appInfoError = ref<string | null>(null)
const route = useRoute()

const navigationItems = [
  { path: '/', label: 'Dashboard', icon: '▦' },
  { path: '/transactions', label: 'Transactions', icon: '⇄' },
  { path: '/recurring', label: 'Recurring', icon: '↻' },
  { path: '/imports', label: 'Imports', icon: '⇩' },
  { path: '/overview', label: 'Overview', icon: '◷' },
  { path: '/settings', label: 'Settings', icon: '⚙' }
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
  <div class="app-shell" :class="{ 'sidebar-collapsed': ui.sidebarCollapsed }">
    <aside class="sidebar" aria-label="Primary navigation">
      <button
        class="sidebar-toggle secondary-button"
        type="button"
        :aria-label="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :title="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!ui.sidebarCollapsed"
        aria-controls="primary-navigation"
        @click="ui.toggleSidebar"
      >
        <span aria-hidden="true">{{ ui.sidebarCollapsed ? '»' : '«' }}</span>
      </button>
      <div v-if="!ui.sidebarCollapsed" class="brand">
        <h1>Sampo</h1>
        <p>Local-first personal finance</p>
      </div>

      <nav id="primary-navigation" class="navigation">
        <RouterLink
          v-for="item in navigationItems"
          :key="item.path"
          :to="item.path"
          class="navigation-link"
          :title="item.label"
          :aria-label="item.label"
        >
          <span class="navigation-icon" aria-hidden="true">{{ item.icon }}</span>
          <span v-if="!ui.sidebarCollapsed">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <button
          type="button"
          class="theme-toggle secondary-button"
          :aria-label="ui.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          :title="ui.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="ui.toggleTheme"
        >
          <span aria-hidden="true">{{ ui.theme === 'dark' ? '☀' : '☾' }}</span>
          <span v-if="!ui.sidebarCollapsed">{{
            ui.theme === 'dark' ? 'Light mode' : 'Dark mode'
          }}</span>
        </button>
        <div v-if="!ui.sidebarCollapsed" class="app-version" aria-live="polite">
          <span v-if="appInfo">Version {{ appInfo.version }}</span>
          <span v-else>{{ appInfoError ?? 'Loading version' }}</span>
        </div>
      </div>
    </aside>

    <main class="content" data-main-scroll>
      <header class="content-header">
        <p>Current section</p>
        <h2>{{ currentSection }}</h2>
      </header>

      <RouterView />
    </main>
  </div>
</template>
