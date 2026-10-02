import { describe, it, expect } from 'vitest'
import { createPhraseCounter } from './phrase-counts'

describe('createPhraseCounter', () => {
  const count = createPhraseCounter([
    { description: 'STARBUCKS #123', n: 4 },
    { description: 'Starbucks Reserve', n: 2 },
    { description: 'Amazon 50% off_sale', n: 1 },
    { description: 'CAFÉ NOIR', n: 3 }
  ])

  it('sums grouped rows whose description contains the phrase, ignoring ASCII case', () => {
    expect(count('starbucks')).toBe(6)
    expect(count('StarBucks #')).toBe(4)
    expect(count('nothing')).toBe(0)
  })

  it('treats LIKE wildcards in the phrase literally', () => {
    expect(count('50%')).toBe(1)
    expect(count('off_s')).toBe(1)
    expect(count('%')).toBe(1)
    expect(count('_')).toBe(1)
  })

  it('folds only ASCII letters, like SQLite lower()', () => {
    expect(count('café')).toBe(0)
    expect(count('cafÉ noir')).toBe(3)
  })

  it('an empty phrase matches everything', () => {
    expect(count('')).toBe(10)
  })
})
