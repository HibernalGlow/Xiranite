import { describe, expect, test, vi } from "vitest"
import { openComponentOnce } from "./useWindowControls"

const input = { componentId: "component-1", moduleId: "enginev" }

describe("openComponentOnce", () => {
  test("coalesces concurrent opens for the same component", async () => {
    let settle: ((value: { success: true; supported: true; message: string }) => void) | undefined
    const open = vi.fn(() => new Promise<{ success: true; supported: true; message: string }>((resolve) => {
      settle = resolve
    }))

    const first = openComponentOnce(input, open)
    const second = openComponentOnce(input, open)

    expect(open).toHaveBeenCalledTimes(1)
    settle?.({ success: true, supported: true, message: "Opened" })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)

    const third = openComponentOnce(input, open)
    settle?.({ success: true, supported: true, message: "Opened again" })
    await third
    expect(open).toHaveBeenCalledTimes(2)
  })
})
