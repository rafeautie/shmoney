import type { HastNode } from '@/lib/rehype-amount'

// code keeps its exact text nodes (highlighting, copy); it streams in unfaded
const SKIPPED_TAGS = new Set(['code', 'pre'])

const word = (children: HastNode[]): HastNode => ({
  type: 'element',
  tagName: 'span',
  properties: { dataWord: true },
  children
})

function splitWords(value: string): HastNode[] {
  return value
    .split(/(\s+)/)
    .filter((piece) => piece !== '')
    .map((piece) =>
      /^\s+$/.test(piece) ? { type: 'text', value: piece } : word([{ type: 'text', value: piece }])
    )
}

function walk(node: HastNode): void {
  if (!node.children) return
  if (node.type === 'element' && node.tagName !== undefined && SKIPPED_TAGS.has(node.tagName)) {
    return
  }
  const nextChildren: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text') {
      nextChildren.push(...splitWords(child.value ?? ''))
    } else if (child.properties?.dataAmount !== undefined) {
      // an amount renders as one component, so it fades as one word
      nextChildren.push(word([child]))
    } else {
      walk(child)
      nextChildren.push(child)
    }
  }
  node.children = nextChildren
}

/** Rehype plugin wrapping each word of prose (and each amount) in a
 * `<span data-word>`, the unit a streaming answer fades in by. Runs after
 * rehypeAmount so amounts are already whole. */
export function rehypeWords() {
  return (tree: HastNode): void => {
    walk(tree)
  }
}
