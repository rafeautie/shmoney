import os from 'node:os'
import type { HardwareInfo } from '@shared/llm'

/**
 * The hardware facts the LLM subsystem gates on. RAM is the reliable floor for
 * a CPU-run GGUF model (GPU offload only lowers the real requirement), so total
 * physical RAM is what we measure here; node-llama-cpp does its own GPU/VRAM
 * detection at load time. Kept in main because os.totalmem can't run in the
 * shared/renderer layers — the pure capability logic over this number lives in
 * @shared/llm.
 */
export function getHardwareInfo(): HardwareInfo {
  return { totalRamBytes: os.totalmem() }
}
