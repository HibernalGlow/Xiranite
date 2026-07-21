import { describe, expect, it, vi } from "vitest"

import type { ExternalEmmStore } from "./ReadonlyLegacyEmmRecordStore.js"
import { ReloadableReadonlyLegacyEmmStore } from "./ReloadableReadonlyLegacyEmmStore.js"

describe("ReloadableReadonlyLegacyEmmStore", () => {
  it("[neoview.emm-config.live-reconfigure] atomically switches readers and drains the retired store", async () => {
    const pending = Promise.withResolvers<ReadonlyMap<string, { emmJson?: string }>>()
    const first = store(() => pending.promise)
    const second = store(async () => new Map([["B.cbz", { emmJson: "second" }]]))
    const resource = new ReloadableReadonlyLegacyEmmStore(first)

    const inFlight = resource.readDirectoryEmmRecords(["A.cbz"])
    const replacing = resource.replace(second)
    expect(first.close).not.toHaveBeenCalled()
    await expect(resource.readDirectoryEmmRecords(["B.cbz"])).resolves.toEqual(new Map([["B.cbz", { emmJson: "second" }]]))

    pending.resolve(new Map([["A.cbz", { emmJson: "first" }]]))
    await expect(inFlight).resolves.toEqual(new Map([["A.cbz", { emmJson: "first" }]]))
    await replacing
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).not.toHaveBeenCalled()

    await resource[Symbol.asyncDispose]()
    expect(second.close).toHaveBeenCalledOnce()
  })
})

function store(read: ExternalEmmStore["readDirectoryEmmRecords"]): ExternalEmmStore {
  return {
    directoryEmmAvailable: true,
    readDirectoryEmmRecords: vi.fn(read),
    sampleEmmTags: vi.fn(async () => []),
    close: vi.fn(),
  }
}
