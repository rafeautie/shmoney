import { describe, expect, it } from 'vitest'
import { toGlyphs } from './mask-glyphs'

/** d = dot, x = folds away, p = pad dot, anything else stays as itself */
const shape = (text: string): string =>
  toGlyphs(text)
    .map((g) => (g.kind === 'fixed' ? g.char : { digit: 'd', drop: 'x', pad: 'p' }[g.kind]))
    .join('')

describe('toGlyphs', () => {
  it('keeps four dots and folds the rest of a large figure', () => {
    expect(shape('$48,213.07')).toBe('$ddxddxxxx')
  })

  it('pads a short figure up to four dots', () => {
    expect(shape('−$6.75')).toBe('−$dxddp')
  })

  it('folds a compact suffix so it cannot hint at magnitude', () => {
    expect(shape('$1.2K')).toBe('$dxdppx')
    expect(shape('-$15M')).toBe('-$ddppx')
  })

  it('pads right after the last digit, before a trailing symbol', () => {
    expect(shape('1 234,56 €')).toBe('dxdddxxx €')
    expect(shape('6,75 €')).toBe('dxddp €')
  })

  it('keeps a trailing currency code apart from the digits', () => {
    expect(shape('12.50 XYZ')).toBe('ddxdd XYZ')
  })

  it('leaves text without digits alone', () => {
    expect(shape('n/a')).toBe('n/a')
  })

  it('numbers animated glyphs left to right, pads last', () => {
    const indexes = toGlyphs('$6.75')
      .filter((g) => g.kind !== 'fixed')
      .map((g) => g.index)
    expect(indexes).toEqual([0, 1, 2, 3, 4])
  })
})
