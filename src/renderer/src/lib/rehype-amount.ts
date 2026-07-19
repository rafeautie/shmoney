// Minimal hast node shape covering root/element/text nodes; other node types
// (comment, doctype, etc.) pass through untouched since we only ever inspect
// `type`/`tagName`/`value` and recurse via `children`.
export interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const SKIPPED_TAGS = new Set(['code', 'pre', 'a'])

function splitTextNode(node: HastNode): HastNode[] {
  const text = node.value ?? ''
  const pattern = /\{\{(-?\d+(?:\.\d+)?) ([A-Z]{3})\}\}/g
  const result: HastNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let matched = false

  while ((match = pattern.exec(text))) {
    matched = true
    if (match.index > lastIndex) {
      result.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    result.push({
      type: 'element',
      tagName: 'span',
      properties: { dataAmount: match[1], dataCurrency: match[2] },
      children: []
    })
    lastIndex = match.index + match[0].length
  }

  if (!matched) {
    return [node]
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return result
}

function walk(node: HastNode): void {
  if (!node.children) return
  if (node.type === 'element' && node.tagName !== undefined && SKIPPED_TAGS.has(node.tagName)) {
    return
  }

  const nextChildren: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      nextChildren.push(...splitTextNode(child))
    } else {
      walk(child)
      nextChildren.push(child)
    }
  }
  node.children = nextChildren
}

/** Rehype plugin turning `{{1234.56 USD}}` markers into `<span data-amount data-currency>` nodes. */
export function rehypeAmount() {
  return (tree: HastNode): void => {
    walk(tree)
  }
}
