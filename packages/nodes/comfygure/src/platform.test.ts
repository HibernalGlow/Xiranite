import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
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
