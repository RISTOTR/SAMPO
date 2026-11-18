import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import TapioExportButton from '../components/TapioExportButton.vue'

describe('Tapio export button', () => {
  it('disables export without checked rows and displays the checked count', async () => {
    const empty = await renderToString(createSSRApp(TapioExportButton, { transactionIds: [] }))
    expect(empty).toContain('disabled')
    expect(empty).toContain('Export 0 selected for Tapio')
    const selected = await renderToString(
      createSSRApp(TapioExportButton, { transactionIds: ['a', 'b', 'c'] })
    )
    expect(selected).not.toContain('disabled')
    expect(selected).toContain('Export 3 selected for Tapio')
  })
})
