import { describe, expect, it, vi } from "vitest"

import { persistReaderSettingsWithTimeout } from "./reader-settings-save-timeout"

describe("persistReaderSettingsWithTimeout", () => {
  it("[neoview.settings.save-timeout] aborts and rejects a write that never settles", async () => {
    vi.useFakeTimers()
    try {
      const persist = vi.fn(() => new Promise<string>(() => undefined))
      const result = persistReaderSettingsWithTimeout({
        persist,
        signal: new AbortController().signal,
        timeoutMs: 10,
      })
      const rejection = expect(result).rejects.toThrow("保存设置超时")

      await vi.advanceTimersByTimeAsync(10)
      await rejection
      expect(persist.mock.calls[0]?.[0].aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
