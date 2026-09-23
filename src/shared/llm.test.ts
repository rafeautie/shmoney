import { describe, it, expect } from 'vitest'
import {
  LLM_MODELS,
  MODEL_IDS,
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
    expect(recommendedModelId(hw)).toBe('qwen35-4b')
  })

  it('leans to the larger model once the machine can run it', () => {
    const hw = gib(16)
    expect(modelRunnable(LLM_MODELS.e4b, hw)).toBe(true)
    expect(recommendedModelId(hw)).toBe('qwen35-9b')
  })

  it('recommends only vetted models, never just the largest runnable one', () => {
    const hw = gib(64)
    expect(modelRunnable(LLM_MODELS['gemma4-12b'], hw)).toBe(true)
    expect(recommendedModelId(hw)).toBe('qwen35-9b')
  })

  it('derives labels and file names, keeping the legacy Gemma file names', () => {
    expect(LLM_MODELS.e2b.label).toBe('Gemma 4 E2B')
    expect(LLM_MODELS.e2b.fileName).toBe('gemma-4-E2B-it-qat.gguf')
    expect(LLM_MODELS['qwen35-4b'].fileName).toBe('Qwen3.5-4B-Q6_K.gguf')
    expect(LLM_MODELS['qwen35-4b'].id).toBe('qwen35-4b')
  })

  it('lists models smallest to largest by download', () => {
    const sizes = MODEL_IDS.map((id) => LLM_MODELS[id].downloadBytes)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  })

  it('marks a model comfortable only above its recommended RAM', () => {
    expect(modelComfortable(LLM_MODELS.e2b, gib(8))).toBe(false)
    expect(modelComfortable(LLM_MODELS.e2b, gib(16))).toBe(true)
    expect(modelComfortable(LLM_MODELS.e4b, gib(16))).toBe(false)
    expect(modelComfortable(LLM_MODELS.e4b, gib(32))).toBe(true)
  })
})
