export async function waitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  disposeLateResult?: (result: T) => Promise<unknown> | unknown,
): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) {
    void operation.then(
      (result) => void Promise.resolve(disposeLateResult?.(result)).catch(() => undefined),
      () => undefined,
    )
    signal.throwIfAborted()
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = () => {
      signal.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      finish()
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void operation.then(
      (result) => {
        if (settled) {
          void Promise.resolve(disposeLateResult?.(result)).catch(() => undefined)
          return
        }
        settled = true
        finish()
        resolve(result)
      },
      (error) => {
        if (settled) return
        settled = true
        finish()
        reject(error)
      },
    )
  })
}
