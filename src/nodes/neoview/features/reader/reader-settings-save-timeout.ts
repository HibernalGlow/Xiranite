const DEFAULT_READER_SETTINGS_SAVE_TIMEOUT_MS = 10_000

export async function persistReaderSettingsWithTimeout<T>(options: {
  persist(signal: AbortSignal): Promise<T>
  signal: AbortSignal
  timeoutMs?: number
}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READER_SETTINGS_SAVE_TIMEOUT_MS
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(options.signal.reason)
  options.signal.addEventListener("abort", forwardAbort, { once: true })
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error("保存设置超时，请重试。"))
    }, timeoutMs)
  })
  try {
    return await Promise.race([options.persist(controller.signal), deadline])
  } catch (error) {
    if (timedOut) throw new Error("保存设置超时，请重试。")
    throw error
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    options.signal.removeEventListener("abort", forwardAbort)
  }
}
