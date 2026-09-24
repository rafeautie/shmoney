// Inside an iframe, scrollIntoView and focus() scroll every ancestor scroller,
// the host page included: the chat's message list anchoring itself, or an
// autofocused input, would yank the page an embed sits on. While framed, both
// only scroll containers inside the demo.

type Block = 'start' | 'center' | 'end' | 'nearest'

function scrollable(element: Element): boolean {
  const style = getComputedStyle(element)
  return (
    /auto|scroll|overlay/.test(style.overflowY + style.overflowX) &&
    (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
  )
}

function offset(
  block: Block,
  item: number,
  itemSize: number,
  box: number,
  boxSize: number
): number {
  if (block === 'start') return item - box
  if (block === 'end') return item + itemSize - (box + boxSize)
  if (block === 'center') return item + itemSize / 2 - (box + boxSize / 2)
  if (item < box) return item - box
  if (item + itemSize > box + boxSize) return item + itemSize - (box + boxSize)
  return 0
}

function scrollWithin(
  element: Element,
  block: Block,
  inline: Block,
  behavior?: ScrollBehavior
): void {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (!scrollable(parent)) continue
    const box = parent.getBoundingClientRect()
    const item = element.getBoundingClientRect()
    parent.scrollBy({
      top: offset(block, item.top, item.height, box.top, parent.clientHeight),
      left: offset(inline, item.left, item.width, box.left, parent.clientWidth),
      behavior
    })
  }
}

export function containScrolling(): void {
  if (window.parent === window) return

  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions): void {
    const options: ScrollIntoViewOptions =
      typeof arg === 'object' ? arg : { block: arg === false ? 'end' : 'start' }
    scrollWithin(
      this,
      (options.block as Block) ?? 'start',
      (options.inline as Block) ?? 'nearest',
      options.behavior
    )
  }

  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (options?: FocusOptions): void {
    focus.call(this, { ...options, preventScroll: true })
    if (!options?.preventScroll) scrollWithin(this, 'nearest', 'nearest')
  }
}
