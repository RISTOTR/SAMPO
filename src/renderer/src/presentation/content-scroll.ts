/** Scroll only the application content, never scrollIntoView's chain of ancestors. */
export function scrollPanelIntoContent(panel: HTMLElement | null | undefined): void {
  const content = panel?.closest<HTMLElement>('[data-main-scroll]')
  if (!content || !panel) return
  setScrollTop(
    content,
    content.scrollTop + panel.getBoundingClientRect().top - content.getBoundingClientRect().top - 16
  )
}

function setScrollTop(content: HTMLElement, top: number): void {
  content.scrollTop = Math.max(0, Math.min(top, content.scrollHeight - content.clientHeight))
}

/** Capture only local DOM position; identifiers never leave renderer memory. */
export function captureTransactionPosition(root: HTMLElement | null | undefined): () => void {
  const content = root?.closest<HTMLElement>('[data-main-scroll]')
  if (!content || !root) return () => {}
  const top = content.getBoundingClientRect().top
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-transaction-row]'))
  const index = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > top && rect.top < top + content.clientHeight
  })
  const row = rows[index]
  const id = row?.dataset.transactionRow
  const offset = row ? row.getBoundingClientRect().top - top : 0
  const scrollTop = content.scrollTop
  return () => {
    if (!root.isConnected || !content.isConnected) return
    const nextRows = Array.from(root.querySelectorAll<HTMLElement>('[data-transaction-row]'))
    const anchor = row
      ? (nextRows.find((item) => item.dataset.transactionRow === id) ??
        nextRows[Math.min(index, nextRows.length - 1)])
      : undefined
    setScrollTop(
      content,
      anchor
        ? content.scrollTop +
            anchor.getBoundingClientRect().top -
            content.getBoundingClientRect().top -
            offset
        : scrollTop
    )
  }
}
