import { describe, it, expect } from 'vitest'
import { nextUiScale, settingSchemas } from './settings'

describe('nextUiScale', () => {
  it('steps to the neighboring scale', () => {
    expect(nextUiScale(1, 1)).toBe(1.1)
    expect(nextUiScale(1.2, -1)).toBe(1.1)
  })

  it('clamps at both ends', () => {
    expect(nextUiScale(1.5, 1)).toBe(1.5)
    expect(nextUiScale(0.8, -1)).toBe(0.8)
  })

  it('resets to 1', () => {
    expect(nextUiScale(1.3, 0)).toBe(1)
  })
})

describe('uiScale schema', () => {
  it('accepts only the listed steps', () => {
    expect(settingSchemas.uiScale.safeParse(1.2).success).toBe(true)
    expect(settingSchemas.uiScale.safeParse(1.15).success).toBe(false)
  })
})
