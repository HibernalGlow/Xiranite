import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PlatformEmmCollectTagSource, parseCollectTags } from "./PlatformEmmCollectTagSource.js"

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("PlatformEmmCollectTagSource", () => {
  it("[neoview.folder.emm-settings] parses and deduplicates EMM collectTag records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-emm-settings-"))
    directories.push(directory)
    const path = join(directory, "setting.json")
    await writeFile(path, JSON.stringify({ collectTag: [
      { cat: "female", tag: "glasses", color: "red" },
      { id: "female:glasses", cat: "Female", tag: "GLASSES" },
      { letter: "artist", tag: "name" },
      { cat: "missing" },
    ] }))
    const source = new PlatformEmmCollectTagSource({ settingPath: path, mixedGender: true })
    await expect(source.load()).resolves.toEqual({
      tags: [{ category: "female", tag: "glasses" }, { category: "artist", tag: "name" }],
      mixedGender: true,
    })
    const snapshot = await source.load()
    expect(JSON.stringify(snapshot)).not.toContain(path)
  })

  it("[neoview.folder.emm-settings-cancel] passes cancellation into an in-flight settings read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-emm-settings-cancel-"))
    directories.push(directory)
    const path = join(directory, "setting.json")
    await writeFile(path, JSON.stringify({ collectTag: [] }))
    const source = new PlatformEmmCollectTagSource({ settingPath: path })
    const controller = new AbortController()
    const readFileMock = vi.mocked(readFile)
    const pendingRead = Promise.withResolvers<string>()
    readFileMock.mockImplementationOnce(((_path: unknown, options: unknown) => {
      const signal = typeof options === "object" && options !== null && "signal" in options
        ? (options as { signal?: AbortSignal }).signal
        : undefined
      signal?.addEventListener("abort", () => pendingRead.reject(signal.reason), { once: true })
      return pendingRead.promise
    }) as typeof readFile)
    const pending = source.load(controller.signal)

    await vi.waitFor(() => expect(readFileMock).toHaveBeenCalledWith(path, { encoding: "utf8", signal: controller.signal }))
    const reason = new DOMException("Cancelled", "AbortError")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it("rejects malformed JSON in the pure parser", () => {
    expect(() => parseCollectTags("{" )).toThrow()
  })
})
