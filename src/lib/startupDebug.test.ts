import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  window.localStorage.setItem("xiranite.log.level", "debug")
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(window, "setInterval").mockReturnValue(0)
  fetchMock.mockClear()
})

afterEach(() => {
  window.localStorage.removeItem("xiranite.log.level")
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("startupDebug", () => {
  it("uninstalls diagnostics when the shared level is lowered", async () => {
    await import("./startupDebug")
    expect(window.__xiraniteDebug?.enabled).toBe(true)

    window.__xiraniteLog?.setLevel("warn")

    expect(window.__xiraniteDebug).toBeUndefined()
  })

  it("batches diagnostic events into one bounded transport request", async () => {
    const { startupDebug } = await import("./startupDebug")
    await vi.advanceTimersByTimeAsync(100)
    fetchMock.mockClear()

    startupDebug("qa:first", { ordinal: 1 })
    startupDebug("qa:second", { ordinal: 2 })
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, request] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String((request as RequestInit).body))).toMatchObject({
      events: [
        { type: "debug", scope: "xiranite:startup", args: ["qa:first", { sequence: 2, detail: { ordinal: 1 } }] },
        { type: "debug", scope: "xiranite:startup", args: ["qa:second", { sequence: 3, detail: { ordinal: 2 } }] },
      ],
    })
  })

  it("routes NeoView diagnostics through the shared transport only once", async () => {
    const { neoviewDebug } = await import("../nodes/neoview/neoviewDebug")
    await vi.advanceTimersByTimeAsync(100)
    fetchMock.mockClear()

    neoviewDebug("qa:single-transport", { component: "reader" })
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, request] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String((request as RequestInit).body))).toMatchObject({
      events: [
        {
          type: "debug",
          scope: "xiranite:startup",
          args: ["neoview:qa:single-transport", { detail: { live: 0, detail: { component: "reader" } } }],
        },
      ],
    })
  })
})
