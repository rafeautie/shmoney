import { describe, expect, it } from 'vitest'
import { createUsageMeter, type UsageMeter } from './usage-meter'

function setup(loadMs: number | null = null): {
  sim: { t: number; input: number; output: number }
  meter: UsageMeter
  generate: (ms: number, tokens: number) => void
} {
  const sim = { t: 1000, input: 0, output: 0 }
  const meter = createUsageMeter({
    modelId: 'qwen35-4b',
    now: () => sim.t,
    readTokens: () => ({ inputTokens: sim.input, outputTokens: sim.output }),
    readContext: () => ({ contextTokens: sim.input + sim.output, contextSize: 12288 }),
    loadMs
  })
  // the clock advances, then the model produces `tokens` and a callback samples
  const generate = (ms: number, tokens: number): void => {
    sim.t += ms
    sim.output += tokens
    meter.sample()
  }
  return { sim, meter, generate }
}

describe('usage meter', () => {
  it('times the first token and counts only spans between generated tokens', () => {
    const { sim, meter, generate } = setup()
    sim.input = 500
    generate(400, 1) // prefill, then the first token
    generate(100, 4)
    generate(100, 4)
    const stats = meter.finish('endOfTurn')
    expect(stats.ttftMs).toBe(400)
    expect(stats.decodeTokens).toBe(8)
    expect(stats.decodeMs).toBe(200)
    expect(stats.outputTokens).toBe(9)
    expect(stats.prefillMs).toBe(400)
    expect(stats.totalMs).toBe(600)
    expect(stats.contextTokens).toBe(509)
    expect(stats.stopReason).toBe('endOfTurn')
  })

  it('keeps a tool run and the evaluation of its result out of generation time', () => {
    const { sim, meter, generate } = setup()
    generate(300, 1)
    generate(100, 5)
    // the model wrote the call; the handler starts
    sim.t += 50
    sim.output += 2
    meter.pause()
    sim.t += 700 // the tool runs
    meter.addToolMs(700)
    sim.input += 200
    generate(250, 1) // result prefill, then the first token after it
    generate(100, 5)
    const stats = meter.finish('endOfTurn')
    expect(stats.decodeTokens).toBe(12)
    expect(stats.decodeMs).toBe(250)
    expect(stats.toolMs).toBe(700)
    expect(stats.prefillMs).toBe(stats.totalMs - 250 - 700)
  })

  it('reports nothing generated as a null first-token time', () => {
    const { sim, meter } = setup(1800)
    sim.t += 120
    meter.sample()
    const stats = meter.finish('aborted')
    expect(stats.ttftMs).toBeNull()
    expect(stats.decodeTokens).toBe(0)
    expect(stats.loadMs).toBe(1800)
    expect(stats.stopReason).toBe('aborted')
  })

  it('leaves the stop reason open on live snapshots', () => {
    const { meter, generate } = setup()
    generate(100, 1)
    expect(meter.snapshot().stopReason).toBeNull()
  })
})
