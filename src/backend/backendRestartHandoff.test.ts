import { afterEach, describe, expect, it, vi } from "vitest"
import { BACKEND_RESTART_HANDOFF_MS, closeBackendAfterHandoff } from "../../scripts/backend-restart-handoff"

afterEach(() => {
  vi.useRealTimers()
})

describe("backend restart handoff", () => {
  it("keeps the previous backend alive while desktop clients refresh the dev manifest", async () => {
    vi.useFakeTimers()
    const close = vi.fn()

    closeBackendAfterHandoff({ close })
    await vi.advanceTimersByTimeAsync(BACKEND_RESTART_HANDOFF_MS - 1)
    expect(close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(close).toHaveBeenCalledOnce()
  })
})
