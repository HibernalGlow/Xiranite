import { describe, expect, it, vi } from "vitest"

import type { ReaderImageTrimSettings } from "@xiranite/node-neoview/image-trim"
import { createReaderImageTrimStore } from "./ReaderImageTrimStore"

describe("ReaderImageTrimStore", () => {
  it("[neoview.image-trim.store] previews locally and writes once on commit", async () => {
    const persist = vi.fn(async (settings: ReaderImageTrimSettings) => settings)
    const store = createReaderImageTrimStore({ persist })
    store.hydrate({ enabled: false, top: 0, bottom: 0, left: 0, right: 0, linkVertical: false, linkHorizontal: false, autoTrimThreshold: 30, autoTrimTarget: "auto" })
    store.preview({ enabled: true, top: 10.5 })
    expect(persist).not.toHaveBeenCalled()
    await store.commit()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ enabled: true, top: 10.5 })
    store.dispose()
  })
})
