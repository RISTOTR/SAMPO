import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import ImportsView from '../views/ImportsView.vue'
import OverviewView from '../views/OverviewView.vue'
import SettingsView from '../views/SettingsView.vue'
import SubscriptionsView from '../views/SubscriptionsView.vue'
import TransactionsView from '../views/TransactionsView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/overview', name: 'overview', component: OverviewView },
    { path: '/imports', name: 'imports', component: ImportsView },
    { path: '/transactions', name: 'transactions', component: TransactionsView },
    { path: '/recurring', name: 'recurring', component: SubscriptionsView },
    { path: '/settings', name: 'settings', component: SettingsView }
  ]
})
