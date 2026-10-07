import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const vuePlugin = vue({ template: { compilerOptions: { hoistStatic: false } } })
const transform = vuePlugin.transform
if (transform && typeof transform === 'object') {
  const handler = transform.handler
  transform.handler = function (code, id, options) {
    // These components are mounted with a client renderer in the Node test environment.
    const clientComponent =
      /\/(FeedbackAlert|TransactionsFeedback|DashboardView|MonthlyTrend|CategorySpending)\.vue(?:\?|$)/.test(
        id
      )
    return handler.call(this, code, id, clientComponent ? { ...options, ssr: false } : options)
  }
}

export default defineConfig({
  plugins: [vuePlugin],
  test: {
    testTimeout: 30000
  }
})
