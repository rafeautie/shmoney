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

// inside table cells the untagged "29379.01 USD" form also converts: the model
// reliably wraps amounts in {{...}} in sentences but drops the braces in table
// cells, and cell content is constrained enough that bare matching can't
// misfire the way it would in prose ("in 2026 USD terms")
const TABLE_CELL_TAGS = new Set(['td', 'th'])

// some models write grouped digits ("24,301.23"), so a well-formed group of
// thousands is accepted and the commas are stripped before the value is used
const NUMBER = String.raw`-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`
const TAGGED_PATTERN = new RegExp(String.raw`\{\{(${NUMBER}) ([A-Z]{3})\}\}`, 'g')
// the tagged alternative first, so a {{...}} match consumes its braces; the
// lookbehind keeps the bare form from starting mid-word or mid-number
// ("v1.2 USD", the ".12" of "1203123.12 USD", the "301" of "24,301 USD"), and
// the \b rejects "1.00 USDC"
const CELL_PATTERN = new RegExp(
  String.raw`\{\{(${NUMBER}) ([A-Z]{3})\}\}|(?<![\w.,])(${NUMBER}) ([A-Z]{3})\b`,
  'g'
)

// the model sometimes wraps a figure that isn't an amount ("{{28.29%}}"), or
// drops the currency; the braces are only ever markup, so show what's inside
const WELL_FORMED = new RegExp(String.raw`^${NUMBER} [A-Z]{3}$`)
const unwrapMalformed = (text: string): string =>
  text.replace(/\{\{([^{}]*)\}\}/g, (tag, inner: string) => (WELL_FORMED.test(inner) ? tag : inner))

function splitTextNode(node: HastNode, inCell: boolean): HastNode[] {
  const original = node.value ?? ''
  const text = unwrapMalformed(original)
  const pattern = inCell ? CELL_PATTERN : TAGGED_PATTERN
  pattern.lastIndex = 0
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
      properties: {
        dataAmount: (match[1] ?? match[3]).replaceAll(',', ''),
        dataCurrency: match[2] ?? match[4]
      },
      children: []
    })
    lastIndex = match.index + match[0].length
  }

  if (!matched) {
    return text === original ? [node] : [{ ...node, value: text }]
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return result
}

function walk(node: HastNode, inCell: boolean): void {
  if (!node.children) return
  if (node.type === 'element' && node.tagName !== undefined && SKIPPED_TAGS.has(node.tagName)) {
    return
  }
  const nextInCell =
    inCell ||
    (node.type === 'element' && node.tagName !== undefined && TABLE_CELL_TAGS.has(node.tagName))

  const nextChildren: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      nextChildren.push(...splitTextNode(child, nextInCell))
    } else {
      walk(child, nextInCell)
      nextChildren.push(child)
    }
  }
  node.children = nextChildren
}

/** Rehype plugin turning `{{1234.56 USD}}` markers — and, inside table cells,
 * bare `1234.56 USD` — into `<span data-amount data-currency>` nodes. */
export function rehypeAmount() {
  return (tree: HastNode): void => {
    walk(tree, false)
  }
}
