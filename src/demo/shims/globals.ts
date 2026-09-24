// Node globals the main-process code leans on, for the browser

if (!('setImmediate' in globalThis)) {
  Object.assign(globalThis, {
    setImmediate: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
      setTimeout(callback, 0, ...args)
  })
}
