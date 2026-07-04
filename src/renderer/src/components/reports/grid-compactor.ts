import {
  collides,
  type CompactType,
  type Compactor,
  type Layout,
  type LayoutItem
} from 'react-grid-layout'

/** State of an in-flight drag or resize, owned by ReportGrid and read by the
 * compactor on every grid event. `snapshot` holds where every item sat when the
 * operation started, so each frame resolves from scratch instead of compounding
 * on the previous frame's result — dragging away from a swap or collision lets
 * every displaced widget return to its original spot before the drop. */
export interface ActiveGridOperation {
  id: string
  kind: 'drag' | 'resize'
  snapshot: Map<string, LayoutItem>
  /** widgets traversed by the current swap run; persists across frames as
   * hysteresis so an engaged swap doesn't flicker at the trigger boundary */
  swapWith: string[]
  /** the active item's last committed slot: where it lands if dropped now.
   * Only updated by a move into empty space, an engaged swap, or a
   * collision-free resize — anything else holds here, so neighbors are never
   * pushed around. */
  accepted: { x: number; y: number; w: number; h: number }
}

/** Collision behavior for the report grid, built on three rules:
 *
 * 1. A widget moves freely into empty space (leaving a gap behind);
 * 2. widgets prefer to displace each other by swapping: a drag along a row or
 *    column exchanges the dragged widget with the group of widgets it has
 *    traversed — one or many, of any sizes. The group slides as a rigid block
 *    into the dragged widget's origin edge and the dragged widget takes the
 *    far edge of the group's region, so gaps between them are preserved. A
 *    swap that would disturb any widget outside the exchange declines whole;
 * 3. when no swap is possible, a committed move (covering blockers past
 *    DISPLACE_THRESHOLD of the dragged widget's area) falls back to pushing
 *    the blockers down, cascading recursively through whatever they land on.
 *
 * Anything short of that holds in place — an edge graze moves nothing,
 * nothing ever drifts upward, and user-placed gaps survive. Resizing into a
 * neighbor pushes it down the same way.
 *
 * The custom `type` matters: react-grid-layout's own moveElement only
 * displaces collided items for the built-in vertical/horizontal/null types,
 * so with this compactor it just proposes the dragged item's position and all
 * resolution happens here in compact(), where the pre-drag snapshot lives. */
export function createReportCompactor(activeRef: {
  current: ActiveGridOperation | null
}): Compactor {
  return {
    // custom compactor types are supported at runtime (any unrecognized string
    // is inert in moveElement, which is exactly what this compactor relies on)
    // but the declared CompactType union only lists the built-ins
    type: 'swap-only' as unknown as CompactType,
    allowOverlap: false,
    compact(layout: Layout, _cols: number): Layout {
      const active = activeRef.current

      // Clone, and rewind every non-active item to its pre-operation position.
      const items: LayoutItem[] = []
      for (const item of layout) {
        if (item === undefined) continue
        const clone = { ...item, moved: false }
        if (active && clone.i !== active.id) {
          const snap = active.snapshot.get(clone.i)
          if (snap) {
            clone.x = snap.x
            clone.y = snap.y
            clone.w = snap.w
            clone.h = snap.h
          }
        }
        items.push(clone)
      }

      const activeItem = active ? items.find((l) => l.i === active.id) : undefined
      if (active && activeItem) {
        if (active.kind === 'drag') resolveDrag(items, activeItem, active)
        else resolveResize(items, activeItem, active)
        return items
      }

      // No operation in flight (mount, prop sync, widget add/remove): repair
      // any overlap by cascading items downward. Never moves anything up, so
      // a valid layout passes through untouched.
      pushDownCascade(items, (l) => l.static === true)
      return items
    }
  }
}

/** Cascade every non-pinned item downward past whatever it collides with, in
 * (y, x) order, until the layout is overlap-free. Never moves anything up, so
 * it is the identity on a layout without overlaps. */
function pushDownCascade(items: LayoutItem[], pinned: (l: LayoutItem) => boolean): void {
  const placed = items.filter(pinned)
  const rest = items.filter((l) => !pinned(l)).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const item of rest) {
    let hit: LayoutItem | undefined
    while ((hit = placed.find((p) => collides(p, item))) !== undefined) {
      item.y = hit.y + hit.h
    }
    placed.push(item)
  }
}

/** How much of the dragged widget's own area must sit on top of unswappable
 * blockers before the push-down fallback engages. Below this the drag reads
 * as a graze, not a claim, and nothing moves. Strictly-greater comparison so
 * a half-covered wobble frame stays a hold. */
const DISPLACE_THRESHOLD = 0.5

function overlapArea(a: LayoutItem, b: LayoutItem): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return Math.max(0, w) * Math.max(0, h)
}

/** The dragged item goes where the pointer proposes only when that expresses
 * clear intent: a landing on empty space, an engaged swap, or a committed
 * move onto blockers that cannot swap — which pushes them down, cascading.
 * Anything less holds the last committed slot and the grid stays still.
 *
 * `accepted` is never a swap's landing slot — that position is valid only
 * together with the swap arrangement, so remembering it as a fallback would
 * let a later declined frame commit an overlap. A push-accepted position is
 * safe to remember: the cascade below re-resolves it on every frame. */
function resolveDrag(items: LayoutItem[], a: LayoutItem, active: ActiveGridOperation): void {
  // Empty space wins over an engaged swap: passing beyond a neighbor into a
  // visibly free slot reads as "move here", not "keep exchanging".
  if (!items.some((l) => l !== a && collides(l, a))) {
    active.swapWith = []
    active.accepted = { x: a.x, y: a.y, w: a.w, h: a.h }
    return
  }
  if (applySwap(items, a, active)) return
  const covered = items
    .filter((l) => l !== a && !l.static)
    .reduce((sum, o) => sum + overlapArea(a, o), 0)
  const blockedByStatic = items.some((l) => l !== a && l.static === true && collides(l, a))
  if (covered > DISPLACE_THRESHOLD * a.w * a.h && !blockedByStatic) {
    active.accepted = { x: a.x, y: a.y, w: a.w, h: a.h }
  } else {
    a.x = active.accepted.x
    a.y = active.accepted.y
  }
  pushDownCascade(items, (l) => l.static === true || l === a)
}

/** Resizing pushes whatever it grows into downward, cascading recursively —
 * downward space always exists. Only a static widget stops growth, reverting
 * to the last size that cleared it. Since neighbors are rewound to the
 * snapshot each frame, shrinking back mid-resize brings them home. */
function resolveResize(items: LayoutItem[], a: LayoutItem, active: ActiveGridOperation): void {
  if (items.some((l) => l !== a && l.static === true && collides(l, a))) {
    a.x = active.accepted.x
    a.y = active.accepted.y
    a.w = active.accepted.w
    a.h = active.accepted.h
  } else {
    active.accepted = { x: a.x, y: a.y, w: a.w, h: a.h }
  }
  pushDownCascade(items, (l) => l.static === true || l === a)
}

/** Exchange the dragged item with the group of widgets its drag has traversed
 * along the dominant axis.
 *
 * Eligibility: any non-static widget in the dragged item's origin band
 * (cross-axis overlap with where the drag started) on the drag's side.
 * Walking outward from the origin, a widget joins the group once the dragged
 * item covers half of the narrower of the two along the axis (centers can be
 * unreachable when a wide widget meets a narrow one at the grid edge) or has
 * moved fully beyond it; an engaged widget stays engaged until the overlap
 * fully clears (hysteresis). The first unengaged widget stops the walk.
 *
 * The exchange itself: the group slides as one rigid block so its near edge
 * lands on the dragged item's origin edge, and the dragged item takes the far
 * edge of the group's region — for a single equal neighbor this is a plain
 * position swap; for many it reorders past all of them; gaps inside the
 * region are preserved. If any relocated rect would land on a widget outside
 * the exchange, the whole swap declines and nothing moves.
 *
 * Returns whether a swap is in effect this frame. */
function applySwap(items: LayoutItem[], a: LayoutItem, active: ActiveGridOperation): boolean {
  const origin = active.snapshot.get(a.i)
  if (!origin) return false

  // Classify the gesture by its dominant axis rather than demanding perfect
  // alignment: a slow hand drifts a cell off-axis mid-drag, and that drift
  // must not silently disengage a swap. Cross-axis drift is tolerated up to
  // half the widget's own size; the exchange snaps it back into band.
  const dx = a.x - origin.x
  const dy = a.y - origin.y
  const horizontal = dx !== 0 && Math.abs(dy) < origin.h / 2
  const vertical = dy !== 0 && Math.abs(dx) < origin.w / 2
  let axis: 'x' | 'y'
  if (horizontal && (!vertical || Math.abs(dx) / origin.w >= Math.abs(dy) / origin.h)) axis = 'x'
  else if (vertical) axis = 'y'
  else {
    active.swapWith = []
    return false
  }
  const size = axis === 'x' ? 'w' : 'h'
  const band = axis === 'x' ? 'y' : 'x'
  const bandSize = axis === 'x' ? 'h' : 'w'
  const dir = Math.sign(a[axis] - origin[axis])

  const others = items.filter((l) => l !== a)
  const eligible = others
    .filter(
      (l) =>
        !l.static &&
        l[band] < origin[band] + origin[bandSize] &&
        l[band] + l[bandSize] > origin[band] &&
        (dir > 0 ? l[axis] > origin[axis] : l[axis] < origin[axis])
    )
    .sort((p, q) => (dir > 0 ? p[axis] - q[axis] : q[axis] - p[axis]))

  const walk: LayoutItem[] = []
  for (const cand of eligible) {
    const overlap = Math.max(
      0,
      Math.min(a[axis] + a[size], cand[axis] + cand[size]) - Math.max(a[axis], cand[axis])
    )
    const beyond =
      dir > 0 ? a[axis] + a[size] > cand[axis] + cand[size] : a[axis] < cand[axis]
    const engaged = overlap >= Math.min(a[size], cand[size]) / 2
    const held = active.swapWith.includes(cand.i) && overlap > 0
    if (beyond || engaged || held) walk.push(cand)
    else break
  }

  // A traversed widget whose exchange is infeasible blocks the run there, but
  // the feasible prefix before it still swaps — so try the largest group
  // first and truncate from the far end until one fits.
  for (let count = walk.length; count > 0; count--) {
    const group = walk.slice(0, count)
    const regionStart = Math.min(...group.map((l) => l[axis]))
    const regionEnd = Math.max(...group.map((l) => l[axis] + l[size]))
    const shift = dir > 0 ? origin[axis] - regionStart : origin[axis] + a[size] - regionEnd
    const aPos = dir > 0 ? regionEnd - a[size] : regionStart

    const inGroup = new Set(group.map((l) => l.i))
    const outsiders = others.filter((l) => !inGroup.has(l.i))
    const slots = [
      { ...a, [axis]: aPos, [band]: origin[band] },
      ...group.map((l) => ({ ...l, [axis]: l[axis] + shift }))
    ]
    if (slots.some((slot) => outsiders.some((o) => collides(o, slot)))) continue

    for (const member of group) member[axis] += shift
    a[axis] = aPos
    a[band] = origin[band]
    active.swapWith = group.map((l) => l.i)
    return true
  }

  active.swapWith = []
  return false
}
