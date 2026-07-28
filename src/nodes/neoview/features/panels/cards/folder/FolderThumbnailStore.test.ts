import { describe, expect, it, vi } from "vitest"

import { FolderThumbnailStore, type FolderThumbnailSnapshot } from "./FolderThumbnailStore"

const FIRST_PATH = "C:/books/first.cbz"
const SECOND_PATH = "C:/books/second.cbz"
const MANAGED_URL = "http://127.0.0.1:41000/reader/library/t/first?token=test"

describe("FolderThumbnailStore", () => {
  it("notifies only the paths whose registered thumbnail changed", () => {
    const store = new FolderThumbnailStore()
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    store.subscribe(FIRST_PATH, firstListener)
    store.subscribe(SECOND_PATH, secondListener)
    store.replace(thumbnailSnapshot([
      [FIRST_PATH, "blob:first-v1"],
      [SECOND_PATH, "blob:second-v1"],
    ]))
    firstListener.mockClear()
    secondListener.mockClear()

    store.replace(thumbnailSnapshot([
      [FIRST_PATH, "blob:first-v2"],
      [SECOND_PATH, "blob:second-v1"],
    ]))

    expect(firstListener).toHaveBeenCalled()
    expect(secondListener).not.toHaveBeenCalled()
    expect(store.entry(FIRST_PATH)).toEqual({
      availability: "ready",
      revision: 2,
      thumbnailUrl: "blob:first-v2",
      thumbnailUrls: ["blob:first-v2"],
    })
  })

  it("micro-batches missing active paths into one registration demand", async () => {
    const store = new FolderThumbnailStore()
    const demand = vi.fn()
    store.setDemandHandler(demand)

    const releaseFirst = store.activate(FIRST_PATH)
    const releaseSecond = store.activate(SECOND_PATH)
    await flushMicrotasks()

    expect(demand).toHaveBeenCalledOnce()
    expect([...demand.mock.calls[0]![0]]).toEqual([FIRST_PATH, SECOND_PATH])
    expect(demand.mock.calls[0]![1]).toBe(false)
    expect(store.entry(FIRST_PATH).availability).toBe("checking")
    releaseFirst()
    releaseSecond()
  })

  it("publishes a managed URL as checking until its query reports ready", () => {
    const store = new FolderThumbnailStore()
    const paths = new Set([FIRST_PATH])
    const snapshot = thumbnailSnapshot([[FIRST_PATH, MANAGED_URL]])
    store.beginRegistration(paths, 1)

    store.completeRegistration(snapshot, paths, paths, 1)
    const checking = store.entry(FIRST_PATH)
    expect(checking.availability).toBe("checking")

    store.reportProbeReady(FIRST_PATH, checking.revision)
    expect(store.entry(FIRST_PATH).availability).toBe("ready")
  })

  it.each(["stale", "unavailable"])("forces one re-registration for a %s managed asset", async () => {
    const store = new FolderThumbnailStore()
    const demand = vi.fn()
    store.replace(thumbnailSnapshot([[FIRST_PATH, MANAGED_URL]]))
    store.setDemandHandler(demand)
    const release = store.activate(FIRST_PATH)
    const revision = store.entry(FIRST_PATH).revision

    store.reportProbeError(FIRST_PATH, revision, true)
    await flushMicrotasks()

    expect(demand).toHaveBeenCalledOnce()
    expect([...demand.mock.calls[0]![0]]).toEqual([FIRST_PATH])
    expect(demand.mock.calls[0]![1]).toBe(true)
    expect(store.entry(FIRST_PATH).availability).toBe("checking")
    release()
  })

  it("settles as unavailable when a re-registered asset still cannot be served", async () => {
    const store = new FolderThumbnailStore()
    const demand = vi.fn()
    const paths = new Set([FIRST_PATH])
    const snapshot = thumbnailSnapshot([[FIRST_PATH, MANAGED_URL]])
    store.replace(snapshot)
    store.setDemandHandler(demand)
    const release = store.activate(FIRST_PATH)
    store.reportProbeError(FIRST_PATH, store.entry(FIRST_PATH).revision, true)
    await flushMicrotasks()

    store.beginRegistration(paths, 1)
    store.completeRegistration(snapshot, paths, paths, 1)
    store.reportProbeError(FIRST_PATH, store.entry(FIRST_PATH).revision, true)

    expect(demand).toHaveBeenCalledOnce()
    expect(store.entry(FIRST_PATH).availability).toBe("unavailable")
    release()
  })

  it("checks an unavailable managed asset again when it re-enters the mounted range", () => {
    const store = new FolderThumbnailStore()
    const paths = new Set([FIRST_PATH])
    const snapshot = thumbnailSnapshot([[FIRST_PATH, MANAGED_URL]])
    store.replace(snapshot)
    store.beginRegistration(paths, 1)
    store.completeRegistration(snapshot, paths, new Set(), 1)
    const unavailableRevision = store.entry(FIRST_PATH).revision

    const release = store.activate(FIRST_PATH)

    expect(store.entry(FIRST_PATH).availability).toBe("checking")
    expect(store.entry(FIRST_PATH).revision).toBeGreaterThan(unavailableRevision)
    release()
  })

  it("marks paths omitted by the registration response as unavailable", () => {
    const store = new FolderThumbnailStore()
    const paths = new Set([FIRST_PATH])
    store.beginRegistration(paths, 1)

    store.completeRegistration(thumbnailSnapshot([]), paths, new Set(), 1)

    expect(store.entry(FIRST_PATH).availability).toBe("unavailable")
  })

  it("does not requeue a registration explicitly cancelled by navigation", async () => {
    const store = new FolderThumbnailStore()
    const demand = vi.fn()
    const paths = new Set([FIRST_PATH])
    store.setDemandHandler(demand)
    const release = store.activate(FIRST_PATH)
    await flushMicrotasks()
    demand.mockClear()
    store.beginRegistration(paths, 1)

    store.cancelRegistration(paths, 1, false, false)
    await flushMicrotasks()

    expect(demand).not.toHaveBeenCalled()
    expect(store.entry(FIRST_PATH).availability).toBe("missing")
    release()
  })

  it("removes managed URLs and profiles when their backend context is released", () => {
    const store = new FolderThumbnailStore()
    const fallbackUrl = "blob:first-fallback"
    store.replace({
      thumbnailUrls: new Map([[FIRST_PATH, MANAGED_URL], [SECOND_PATH, "blob:second"]]),
      thumbnailUrlSets: new Map([[FIRST_PATH, [MANAGED_URL, fallbackUrl]], [SECOND_PATH, ["blob:second"]]]),
      thumbnailProfiles: new Map([[FIRST_PATH, "first-profile"], [SECOND_PATH, "second-profile"]]),
    })

    store.clearManagedEntries()

    expect(store.entry(FIRST_PATH)).toMatchObject({ availability: "ready", thumbnailUrl: fallbackUrl, thumbnailUrls: [fallbackUrl] })
    expect(store.snapshot().thumbnailProfiles.has(FIRST_PATH)).toBe(false)
    expect(store.entry(SECOND_PATH).thumbnailUrl).toBe("blob:second")
    expect(store.snapshot().thumbnailProfiles.get(SECOND_PATH)).toBe("second-profile")
  })
})

function thumbnailSnapshot(urls: readonly (readonly [string, string])[]): FolderThumbnailSnapshot {
  return {
    thumbnailUrls: new Map(urls),
    thumbnailUrlSets: new Map(urls.map(([path, url]) => [path, [url]])),
    thumbnailProfiles: new Map(),
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
