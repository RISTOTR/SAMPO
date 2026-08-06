import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/renderer/src/assets/main.css', 'utf8')
const importsView = readFileSync('src/renderer/src/views/ImportsView.vue', 'utf8')
const confirmDialog = readFileSync('src/renderer/src/components/ConfirmDialog.vue', 'utf8')

describe('renderer layout contract', () => {
  it('uses the main content region as the application scroll container', () => {
    expect(css).toContain('html,\nbody,\n#app')
    expect(css).toContain('height: 100%;')
    expect(css).toContain('.app-shell')
    expect(css).toContain('overflow: hidden;')
    expect(css).toContain('.content')
    expect(css).toContain('min-height: 0;')
    expect(css).toContain('overflow-y: auto;')
  })

  it('keeps the import preview table bounded without removing rows', () => {
    expect(importsView).toContain('v-for="transaction in imports.preview.transactions"')
    expect(importsView).toContain('class="table-wrap preview-table-wrap"')
    expect(css).toContain('.preview-table-wrap')
    expect(css).toContain('max-height: min(52vh, 520px);')
    expect(css).toContain('overflow: auto;')
  })

  it('keeps import commit controls rendered after the long preview table', () => {
    const tableIndex = importsView.indexOf('class="table-wrap preview-table-wrap"')
    const actionsIndex = importsView.indexOf('class="button-row preview-actions"')
    const commitIndex = importsView.indexOf('Import transactions')

    expect(tableIndex).toBeGreaterThan(-1)
    expect(actionsIndex).toBeGreaterThan(tableIndex)
    expect(commitIndex).toBeGreaterThan(actionsIndex)
    expect(importsView).toContain('@click="pendingCommitImport = true"')
    expect(importsView).toContain('@confirm="commitImport"')
  })

  it('does not permanently disable body scrolling from the confirm dialog', () => {
    expect(confirmDialog).not.toContain('document.body')
    expect(confirmDialog).not.toContain('overflow')
    expect(css).toContain('.dialog-backdrop')
    expect(css).toContain('overflow-y: auto;')
    expect(css).toContain('.dialog')
    expect(css).toContain('max-height: calc(100vh - 48px);')
  })
})
