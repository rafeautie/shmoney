/** Every hidden figure shows this many dots, so hiding never leaks magnitude. */
export const MASK_DOTS = 4
const DIGIT = /\p{Nd}/u
const SEPARATOR = /[.,'’\s]/u
const LETTER = /\p{L}/u

export type Glyph =
  | { kind: 'fixed'; char: string }
  | { kind: 'digit' | 'drop'; char: string; index: number }
  | { kind: 'pad'; index: number }

/**
 * Splits a formatted figure for the privacy mask: the first four digits become
 * dots ('digit'), later digits and the separators between digits fold away
 * ('drop'), and a short figure grows 'pad' dots right after its last digit.
 * Signs, symbols and currency codes stay put ('fixed'). index orders the
 * animated glyphs left to right for the stagger.
 */
export function toGlyphs(text: string): Glyph[] {
  const chars = [...text]
  const glyphs: Glyph[] = []
  let digits = 0
  let index = 0
  let afterLastDigit = 0
  let inSuffix = false
  chars.forEach((char, i) => {
    const suffix = LETTER.test(char) && (inSuffix || DIGIT.test(chars[i - 1] ?? ''))
    inSuffix = suffix
    if (DIGIT.test(char)) {
      glyphs.push({ kind: digits < MASK_DOTS ? 'digit' : 'drop', char, index: index++ })
      digits++
      afterLastDigit = glyphs.length
    } else if (suffix) {
      // a compact figure's K or M would give its magnitude away
      glyphs.push({ kind: 'drop', char, index: index++ })
    } else if (
      SEPARATOR.test(char) &&
      DIGIT.test(chars[i - 1] ?? '') &&
      DIGIT.test(chars[i + 1] ?? '')
    ) {
      glyphs.push({ kind: 'drop', char, index: index++ })
    } else {
      glyphs.push({ kind: 'fixed', char })
    }
  })
  if (digits === 0) return glyphs
  const pads: Glyph[] = []
  for (; digits < MASK_DOTS; digits++) pads.push({ kind: 'pad', index: index++ })
  glyphs.splice(afterLastDigit, 0, ...pads)
  return glyphs
}
