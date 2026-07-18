import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { emmTranslationKey, PlatformEmmTranslationSource } from "./PlatformEmmTranslationSource.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("PlatformEmmTranslationSource", () => {
  it("[neoview.folder.emm-translation-source] lazily resolves full and abbreviated namespaces without returning the dictionary", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-emm-translation-"))
    roots.push(root)
    const path = join(root, "db.text.json")
    await writeFile(path, JSON.stringify({ data: [
      { namespace: "artist", data: { alice: { name: "爱丽丝", intro: "not returned" } } },
      { namespace: "female", data: { glasses: { name: "眼镜" } } },
    ] }))
    const source = new PlatformEmmTranslationSource({ path })
    const tags = [{ category: "a", tag: "alice" }, { category: "female", tag: "glasses" }, { category: "male", tag: "unknown" }]

    const translated = await source.translate(tags)
    expect(translated).toEqual(new Map([
      [emmTranslationKey(tags[0]!), "爱丽丝"],
      [emmTranslationKey(tags[1]!), "眼镜"],
    ]))
    expect(source.clear()).toBe(true)
    expect(source.clear()).toBe(false)
  })

  it("[neoview.folder.emm-translation-source] rejects oversized or cancelled reads before parsing", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-emm-translation-limit-"))
    roots.push(root)
    const path = join(root, "db.text.json")
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1))
    const source = new PlatformEmmTranslationSource({ path })
    await expect(source.translate([{ category: "artist", tag: "alice" }])).resolves.toEqual(new Map())
    const controller = new AbortController()
    controller.abort(new DOMException("Cancelled", "AbortError"))
    await expect(source.translate([{ category: "artist", tag: "alice" }], controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })
})
