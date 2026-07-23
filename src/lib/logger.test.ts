import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  window.history.replaceState({}, "", "/")
  window.localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("logger", () => {
  it("uses one persisted level for every scoped logger", async () => {
    const loggerModule = await import("./logger")
    const first = loggerModule.createLogger("reader")
    const second = loggerModule.createLogger("workspace")

    expect(loggerModule.getLogLevel()).toBe("warn")
    expect(loggerModule.isLogLevelEnabled("debug")).toBe(false)

    loggerModule.setLogLevel("debug")

    expect(first.level).toBe(4)
    expect(second.level).toBe(4)
    expect(window.localStorage.getItem(loggerModule.LOG_LEVEL_STORAGE_KEY)).toBe("debug")
    expect(loggerModule.isLogLevelEnabled("debug")).toBe(true)
  })

  it("supports the query switch", async () => {
    window.history.replaceState({}, "", "/?log=trace")
    const loggerModule = await import("./logger")
    expect(loggerModule.getLogLevel()).toBe("trace")
  })

  it("batches enabled scoped logs into the development transport", async () => {
    window.localStorage.setItem("xiranite.log.level", "debug")
    const { createLogger } = await import("./logger")

    createLogger("qa").debug("mounted", { componentId: "reader" })
    await vi.advanceTimersByTimeAsync(100)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, request] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe("/__xiranite-log")
    expect(JSON.parse(String(request?.body))).toMatchObject({
      events: [{ type: "debug", scope: "xiranite:qa", args: ["mounted", { componentId: "reader" }] }],
    })
  })

  it("exposes a runtime controller for temporary diagnostics", async () => {
    await import("./logger")

    window.__xiraniteLog?.setLevel("trace")

    expect(window.__xiraniteLog?.getLevel()).toBe("trace")
    expect(window.localStorage.getItem("xiranite.log.level")).toBe("trace")
  })
})
