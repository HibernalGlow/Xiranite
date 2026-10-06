// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { useDirectNodeAppSessionState } from "./nodeAppState"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test("keeps direct-node state in the current React session without backend persistence", () => {
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)

  render(<SessionStateHarness />)
  expect(screen.getByTestId("state").textContent).toBe("ready:0")

  fireEvent.click(screen.getByRole("button", { name: "Increment" }))
  expect(screen.getByTestId("state").textContent).toBe("ready:1")
  expect(fetch).not.toHaveBeenCalled()
})

function SessionStateHarness() {
  const state = useDirectNodeAppSessionState(undefined, true)
  const count = typeof state.data.count === "number" ? state.data.count : 0
  return (
    <>
      <output data-testid="state">{state.ready ? "ready" : "pending"}:{count}</output>
      <button type="button" onClick={() => state.patchData({ count: count + 1 })}>Increment</button>
    </>
  )
}
