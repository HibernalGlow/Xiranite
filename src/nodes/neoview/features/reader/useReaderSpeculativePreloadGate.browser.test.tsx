import { afterEach, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { useEffect, useState } from "react"

import { useReaderSpeculativePreloadGate } from "./useReaderSpeculativePreloadGate"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("[neoview.preload.idle-gate-gui] holds speculative work through first paint and resets after reader input", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => window.setTimeout(
    () => callback({ didTimeout: false, timeRemaining: () => 50 }),
    0,
  ))
  vi.stubGlobal("cancelIdleCallback", (handle: number) => window.clearTimeout(handle))

  await render(<Fixture />)

  expect(document.querySelector("[data-speculative-preload]")?.getAttribute("data-speculative-preload")).toBe("blocked")
  await expect.poll(() => document.querySelector("[data-speculative-preload]")?.getAttribute("data-speculative-preload")).toBe("allowed")

  document.dispatchEvent(new WheelEvent("wheel", { bubbles: true }))
  await expect.poll(() => document.querySelector("[data-speculative-preload]")?.getAttribute("data-speculative-preload")).toBe("blocked")
  await expect.poll(() => document.querySelector("[data-speculative-preload]")?.getAttribute("data-speculative-preload")).toBe("allowed")
})

test("[neoview.preload.idle-gate-gui] never reuses a prior book admission for a new first paint", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => window.setTimeout(
    () => callback({ didTimeout: false, timeRemaining: () => 50 }),
    0,
  ))
  vi.stubGlobal("cancelIdleCallback", (handle: number) => window.clearTimeout(handle))

  const observedAdmissions: string[] = []
  await render(<SessionFixture observedAdmissions={observedAdmissions} />)
  await expect.poll(() => document.querySelector("[data-speculative-preload]")?.getAttribute("data-speculative-preload")).toBe("allowed")

  document.querySelector<HTMLButtonElement>("[data-next-reader]")!.click()

  await expect.poll(() => document.querySelector("[data-reader-session]")?.textContent).toBe("reader-two")
  await expect.poll(() => observedAdmissions.includes("reader-two:blocked")).toBe(true)
  expect(observedAdmissions).not.toContain("reader-two:allowed")
  await expect.poll(() => document.querySelector("[data-speculative-preload]")?.getAttribute("data-speculative-preload")).toBe("allowed")
})

function Fixture() {
  const allowed = useReaderSpeculativePreloadGate({
    sessionId: "reader-idle-gate",
    frameGeneration: 1,
    enabled: true,
    initialQuietWindowMs: 20,
    navigationQuietWindowMs: 400,
    idleCallbackTimeoutMs: 0,
  })
  return <output data-speculative-preload={allowed ? "allowed" : "blocked"} />
}

function SessionFixture({ observedAdmissions }: { observedAdmissions: string[] }) {
  const [sessionId, setSessionId] = useState("reader-one")
  const allowed = useReaderSpeculativePreloadGate({
    sessionId,
    frameGeneration: 1,
    enabled: true,
    initialQuietWindowMs: 20,
    navigationQuietWindowMs: 20,
    idleCallbackTimeoutMs: 0,
  })
  useEffect(() => {
    observedAdmissions.push(`${sessionId}:${allowed ? "allowed" : "blocked"}`)
  }, [allowed, observedAdmissions, sessionId])
  return <>
    <button type="button" data-next-reader onClick={() => setSessionId("reader-two")}>Next reader</button>
    <output data-reader-session>{sessionId}</output>
    <output data-speculative-preload={allowed ? "allowed" : "blocked"} />
  </>
}
