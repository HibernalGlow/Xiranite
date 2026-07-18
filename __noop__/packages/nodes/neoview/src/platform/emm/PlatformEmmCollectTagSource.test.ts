import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { PlatformEmmCollectTagSource, parseCollectTags } from "./PlatformEmmCollectTagSource.js"

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
      sourcePath: path,
    })
  })

  it("rejects malformed JSON in the pure parser", () => {
    expect(() => parseCollectTags("{" )).toThrow()
  })
})
