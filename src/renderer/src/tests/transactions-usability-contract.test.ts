import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { parse as parseSfc } from '@vue/compiler-sfc'
import {
  baseParse,
  NodeTypes,
  type ElementNode,
  type RootNode,
  type TemplateChildNode
} from '@vue/compiler-dom'
import { transactionColumns } from '../preferences/transaction-columns'

const source = readFileSync('src/renderer/src/views/TransactionsView.vue', 'utf8')
const template = baseParse(parseSfc(source).descriptor.template!.content)
function elements(node: RootNode | TemplateChildNode): ElementNode[] {
  if (node.type === NodeTypes.ROOT) return node.children.flatMap(elements)
  if (node.type !== NodeTypes.ELEMENT) return []
  return [node, ...node.children.flatMap(elements)]
}
const nodes = elements(template)
function attribute(node: ElementNode, name: string): string | undefined {
  const prop = node.props.find((prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === name)
  return prop?.type === NodeTypes.ATTRIBUTE ? prop.value?.content : undefined
}
function directive(node: ElementNode, name: string): string | undefined {
  const prop = node.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === name)
  return prop?.type === NodeTypes.DIRECTIVE && prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
    ? prop.exp.content
    : undefined
}

describe('Transactions usability structure', () => {
  it('keeps the unresolved count and toggle outside the collapsible AI content', () => {
    const body = nodes.find((node) => attribute(node, 'id') === 'ai-suggestions-content')!
    expect(directive(body, 'show')).toBe('!ui.aiPanelCollapsed')
    expect(body.loc.source).not.toContain('class="transactions-table"')
    expect(nodes.some((node) => attribute(node, 'class') === 'transactions-table')).toBe(true)
    const header = nodes.find((node) => attribute(node, 'class')?.includes('ai-panel-header'))!
    expect(header.loc.source).toContain('ai.suggestions.length')
    expect(header.loc.source).toContain('unresolved')
    const toggle = elements(header).find((node) => node.tag === 'button')!
    expect(attribute(toggle, 'aria-controls')).toBe('ai-suggestions-content')
    expect(directive(toggle, 'on')).toBe('ui.toggleAiPanel')
  })

  it('uses matching column guards for headers and cells while selection is always available', () => {
    const table = nodes.find((node) => attribute(node, 'class') === 'transactions-table')!
    const headers = elements(table).filter((node) => node.tag === 'th')
    const cells = elements(table).filter((node) => node.tag === 'td')
    expect(headers).toHaveLength(transactionColumns.length + 1)
    expect(cells).toHaveLength(headers.length)
    expect(directive(headers[0]!, 'if')).toBeUndefined()
    expect(directive(cells[0]!, 'if')).toBeUndefined()
    expect(cells[0]!.loc.source).toContain('v-model="selectedTransactionIds"')
    transactionColumns.forEach((column, index) => {
      expect(directive(headers[index + 1]!, 'if')).toBe(`ui.isColumnVisible('${column.id}')`)
      expect(directive(cells[index + 1]!, 'if')).toBe(directive(headers[index + 1]!, 'if'))
    })
    expect(elements(cells.at(-1)!).some((node) => attribute(node, 'class') === 'button-row')).toBe(
      true
    )
  })

  it('puts the unclassified checkbox before its associated left-aligned label text', () => {
    const label = nodes.find(
      (node) => node.tag === 'label' && attribute(node, 'for') === 'filter-unclassified'
    )!
    expect(attribute(label, 'class')).toBe('checkbox-label')
    const children = label.children.filter(
      (node): node is ElementNode => node.type === NodeTypes.ELEMENT
    )
    expect(children.map((node) => node.tag)).toEqual(['input', 'span'])
    expect(attribute(children[0]!, 'id')).toBe('filter-unclassified')
    expect(directive(children[0]!, 'model')).toBe('filters.unclassifiedOnly')
  })

  it('keeps review markers and selected state on rows even with Class status hidden', () => {
    const row = nodes.find((node) => attribute(node, 'class') === 'transaction-selection')!
    expect(row.loc.source).toContain('transactionReviewLabels')
    const marker = elements(row).find((node) => attribute(node, 'class') === 'review-indicator')!
    expect(attribute(marker, 'role')).toBe('img')
    expect(directive(marker, 'if')).toBeUndefined()
    expect(marker.loc.source).toContain(':aria-label=')
    const tableRow = nodes.find(
      (node) => node.tag === 'tr' && node.loc.source.includes(':data-transaction-row')
    )!
    expect(tableRow.loc.source).toContain('transactionReviewState(transaction)')
    expect(tableRow.loc.source).toContain('selectedTransactionIds.includes(transaction.id)')
    expect(row.loc.source).not.toContain('isColumnVisible')
  })

  it('provides contained horizontal scrolling and wrapping action groups', () => {
    const css = readFileSync('src/renderer/src/assets/main.css', 'utf8')
    // CSS contracts are limited to the layout behavior that cannot be asserted by template rendering.
    expect(css.match(/\.button-row\s*\{([^}]+)\}/)?.[1]).toMatch(/display: flex/)
    expect(css.match(/\.button-row\s*\{([^}]+)\}/)?.[1]).toMatch(/flex-wrap: wrap/)
    expect(css.match(/\.button-row\s*\{([^}]+)\}/)?.[1]).toMatch(/gap:/)
    expect(css.match(/\.table-wrap\s*\{([^}]+)\}/)?.[1]).toMatch(/overflow-x: auto/)
    expect(css).not.toContain('min-width: 900px')
  })
})
