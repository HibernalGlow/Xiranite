import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { createComfygureProfile } from "./core.js"
import { createNodeComfygureRuntime } from "./platform.js"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Comfygure local LoRA trigger resolver", () => {
  it("reads a same-name trigger beside the configured Library LoRA", async () => {
    const library = await temporaryLibrary()
    const trigger = join(library, "models", "loras", "anima", "cat_ears.trigger.txt")
    await mkdir(join(library, "models", "loras", "anima"), { recursive: true })
    await writeFile(trigger, "# metadata\ncat ears\nwhiskers\n", "utf8")

    await expect(readLoraTrigger(library, "anima/cat_ears.safetensors")).resolves.toBe("cat ears\nwhiskers")
  })

  it("does not resolve a trigger outside the configured LoRA root", async () => {
    const library = await temporaryLibrary()
    await expect(readLoraTrigger(library, "../secret.safetensors")).resolves.toBeUndefined()
  })
})

describe("Comfygure local profile store", () => {
  it("stores one atomic, versioned JSON file per profile under the Xiranite data directory", async () => {
    const dataDir = await temporaryLibrary()
    const runtime = createNodeComfygureRuntime({ dataDir, now: () => new Date("2026-07-24T00:00:00.000Z") })
    const store = runtime.profileStore
    if (!store) throw new Error("Comfygure platform does not expose a profile store.")
    const first = createComfygureProfile({ parameters: { width: 1536, height: 896 } }, "ANIMA Portrait", { now: new Date("2026-07-24T00:00:00.000Z") })

    await store.save(first)
    const list = await store.list()
    const loaded = await store.read(first.id)
    const revised = createComfygureProfile(first.program, first.name, { previous: loaded, now: new Date("2026-07-24T01:00:00.000Z") })
    await store.save(revised)

    expect(list).toEqual([{ id: "anima-portrait", name: "ANIMA Portrait", revision: 1, updatedAt: "2026-07-24T00:00:00.000Z" }])
    await expect(store.read(first.id)).resolves.toMatchObject({ revision: 2, createdAt: first.createdAt, updatedAt: "2026-07-24T01:00:00.000Z", program: { parameters: { width: 1536, height: 896 } } })
  })
})

async function temporaryLibrary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "comfygure-library-"))
  tempDirectories.push(directory)
  return directory
}

async function readLoraTrigger(libraryPath: string, loraName: string): Promise<string | undefined> {
  const resolver = createNodeComfygureRuntime().readLoraTrigger
  if (!resolver) throw new Error("Comfygure platform does not expose the local trigger resolver.")
  return await resolver(libraryPath, loraName)
}
