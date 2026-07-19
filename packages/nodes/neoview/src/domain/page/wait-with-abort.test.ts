import { describe, expect, it, vi } from "vitest"

import { waitWithAbort } from "./wait-with-abort.js"

describe("waitWithAbort", () => {
  it("[neoview.page.wait-with-abort] disposes a result that arrives after cancellation", async () => {
    const controller = new AbortController()
    const late = Promise.withResolvers<string>()
    const dispose = vi.fn()
    const pending = waitWithAbort(late.promise, controller.signal, dispose)

    controller.abort(new DOMException("page changed", "AbortError"))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    late.resolve("late result")
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(dispose).toHaveBeenCalledWith("late result")
  })

  it("[neoview.page.wait-with-abort] keeps an already delivered result when cancellation follows", async () => {
    const controller = new AbortController()
    const dispose = vi.fn()

    await expect(waitWithAbort(Promise.resolve("ready"), controller.signal, dispose)).resolves.toBe("ready")
    controller.abort(new DOMException("page changed", "AbortError"))
    await Promise.resolve()
    expect(dispose).not.toHaveBeenCalled()
  })

  it("[neoview.page.wait-with-abort] disposes an already-created result when passed a pre-cancelled signal", async () => {
    const controller = new AbortController()
    const dispose = vi.fn()
    controller.abort(new DOMException("page changed", "AbortError"))

    await expect(waitWithAbort(Promise.resolve("late result"), controller.signal, dispose)).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    expect(dispose).toHaveBeenCalledWith("late result")
  })
})
