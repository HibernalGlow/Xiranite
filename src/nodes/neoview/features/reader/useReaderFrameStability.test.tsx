import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { READER_FRAME_STABLE_MS, useReaderFrameStability } from "./useReaderFrameStability"

describe("useReaderFrameStability", () => {
  it("[neoview.preload.stability] reports a settled duration only after the frame holds still", async () => {
    const view = renderHook(({ generation }) => useReaderFrameStability("reader-1", generation), {
      initialProps: { generation: 1 },
    })

    expect(view.result.current).toBe(0)
    await waitFor(() => expect(view.result.current).toBe(READER_FRAME_STABLE_MS))
  })

  it("[neoview.preload.stability-reset] never carries a settled duration into the next page", async () => {
    const view = renderHook(({ generation }) => useReaderFrameStability("reader-1", generation), {
      initialProps: { generation: 1 },
    })
    await waitFor(() => expect(view.result.current).toBe(READER_FRAME_STABLE_MS))

    view.rerender({ generation: 2 })

    expect(view.result.current).toBe(0)
    await waitFor(() => expect(view.result.current).toBe(READER_FRAME_STABLE_MS))
  })

  it("[neoview.preload.stability-idle] reports nothing while no reader frame is mounted", () => {
    const view = renderHook(() => useReaderFrameStability(undefined, undefined))

    expect(view.result.current).toBe(0)
  })
})
