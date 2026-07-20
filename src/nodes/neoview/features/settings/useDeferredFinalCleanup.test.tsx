import { act, cleanup, render } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createReaderColorFilterStore } from "../color-filter/ReaderColorFilterStore"
import { useDeferredFinalCleanup } from "./useDeferredFinalCleanup"

afterEach(cleanup)

describe("useDeferredFinalCleanup", () => {
  it("keeps stores alive across the StrictMode effect replay and disposes only after final unmount", async () => {
    const persist = vi.fn(async (settings) => settings)
    const store = createReaderColorFilterStore({ persist })

    function Harness() {
      useDeferredFinalCleanup(store.dispose)
      return null
    }

    const view = render(<StrictMode><Harness /></StrictMode>)
    await act(async () => Promise.resolve())

    await store.update({ invert: true })
    expect(persist).toHaveBeenCalledOnce()

    view.unmount()
    await act(async () => Promise.resolve())
    await store.update({ negative: true })
    expect(persist).toHaveBeenCalledOnce()
  })
})
