import { describe, it, expect } from 'vitest'
import {
  LLM_MODELS,
  llmSupported,
  modelComfortable,
  modelRunnable,
  recommendedModelId
} from './llm'

// hardware with n GiB of total RAM; os.totalmem reports bytes, so match that
const gib = (n: number): { totalRamBytes: number } => ({ totalRamBytes: n * 1024 ** 3 })

describe('model capability gating', () => {
  it('disables every model below the smallest one’s minimum', () => {
    const hw = gib(4)
    expect(llmSupported(hw)).toBe(false)
    expect(recommendedModelId(hw)).toBeNull()
    expect(modelRunnable(LLM_MODELS.e2b, hw)).toBe(false)
    expect(modelRunnable(LLM_MODELS.e4b, hw)).toBe(false)
  })

  it('runs only the small model on a mid-range machine', () => {
    const hw = gib(8)
    expect(llmSupported(hw)).toBe(true)
    expect(modelRunnable(LLM_MODELS.e2b, hw)).toBe(true)
    expect(modelRunnable(LLM_MODELS.e4b, hw)).toBe(false)
    expect(recommendedModelId(hw)).toBe('e2b')
  })

  it('leans to the larger model once the machine can run it', () => {
    const hw = gib(16)
    expect(modelRunnable(LLM_MODELS.e4b, hw)).toBe(true)
    expect(recommendedModelId(hw)).toBe('e4b')
  })

  it('marks a model comfortable only above its recommended RAM', () => {
    expect(modelComfortable(LLM_MODELS.e2b, gib(8))).toBe(false)
    expect(modelComfortable(LLM_MODELS.e2b, gib(16))).toBe(true)
    expect(modelComfortable(LLM_MODELS.e4b, gib(16))).toBe(false)
    expect(modelComfortable(LLM_MODELS.e4b, gib(32))).toBe(true)
  })
})
