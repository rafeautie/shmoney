// The worker runs a single chat session. Each generate resets it first (see
// handleGenerate in worker.ts), so completed generates are stateless — but two
// in flight at once would interleave on that one session, and abortGenerate
// stops whichever generation happens to be active. Every feature therefore
// routes its generates through this chain so only one runs at a time.
let chain: Promise<unknown> = Promise.resolve()

/** Run `job` after every previously enqueued job has settled. */
export function enqueueGenerate<T>(job: () => Promise<T>): Promise<T> {
  const result = chain.then(job, job)
  // the chain itself swallows outcomes; callers observe them via `result`
  chain = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
