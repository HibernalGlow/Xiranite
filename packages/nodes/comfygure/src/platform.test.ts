import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"
import { compileAnimaInt8Program, createComfygureProfile } from "./core.js"
import { createNodeComfygureProjectStore, createNodeComfygureRuntime, createStableCanvasComfygureTargetAdapter } from "./platform.js"
import { createComfygureProjectDocument } from "./project.js"

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

describe("Comfygure Project Document store", () => {
  it("atomically saves and integrity-checks explicit .comfygure.json files", async () => {
    const directory = await temporaryLibrary()
    const path = join(directory, "projects", "storyboard.comfygure.json")
    const profile = createComfygureProfile({}, "ANIMA INT8", { now: new Date("2026-07-24T00:00:00.000Z") })
    const project = await createComfygureProjectDocument({ prompts: { positive: "cat ears" } }, {
      id: "storyboard",
      profile,
      now: new Date("2026-07-24T01:00:00.000Z"),
    })
    const store = createNodeComfygureProjectStore()

    await store.save(path, project)

    await expect(store.read(path)).resolves.toEqual(project)
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ format: "comfygure-project/v1", id: "storyboard" })
    await expect(store.save(join(directory, "project.json"), project)).rejects.toThrow(".comfygure.json")
  })
})

describe("Comfygure StableCanvas target adapter", () => {
  it("maps the host-neutral contract onto the pinned client without raw transport calls", async () => {
    const created: Array<{ api_host: string; api_base: string; clientId: string; ssl: boolean }> = []
    const client = {
      getNodeDefs: vi.fn(async () => ({ Loader: { input: { required: {} } } })),
      queuePrompt: vi.fn(async () => ({ prompt_id: "prompt-123", number: 7 })),
      getPromptStatus: vi.fn(async () => ({ running: false, pending: false, done: true })),
      getPromptOutputs: vi.fn(async () => ({ "9": { images: [{ filename: "image.png", subfolder: "batch", type: "output" }] } })),
    }
    const adapter = createStableCanvasComfygureTargetAdapter({
      createClient: (options) => {
        created.push(options)
        return client
      },
    })
    const target = { endpoint: "http://127.0.0.1:8000", clientId: "local-client" }

    await expect(adapter.readObjectInfo(target)).resolves.toEqual({ Loader: { input: { required: {} } } })
    await expect(adapter.submitPrompt(compileAnimaInt8Program(), target)).resolves.toMatchObject({ endpoint: "http://127.0.0.1:8000", promptId: "prompt-123", queueNumber: 7, clientId: "local-client" })
    await expect(adapter.readPromptHistory("prompt-123", target)).resolves.toMatchObject({ state: "complete", images: [{ url: "http://127.0.0.1:8000/view?filename=image.png&subfolder=batch&type=output" }] })

    expect(created).toEqual(expect.arrayContaining([expect.objectContaining({ api_host: "127.0.0.1:8000", api_base: "", clientId: "local-client", ssl: false })]))
    expect(client.queuePrompt).toHaveBeenCalledWith(0, expect.objectContaining({ prompt: expect.any(Object), workflow: undefined }))
  })

  it("serializes concurrent requests for the same local endpoint", async () => {
    let started = 0
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    const adapter = createStableCanvasComfygureTargetAdapter({
      createClient: () => ({
        getNodeDefs: async () => {
          started += 1
          if (started === 1) await first
          return {}
        },
        queuePrompt: async () => ({ prompt_id: "unused" }),
        getPromptStatus: async () => ({ running: false, pending: false, done: true }),
        getPromptOutputs: async () => ({}),
      }),
    })

    const firstRead = adapter.readObjectInfo({ endpoint: "http://127.0.0.1:8000" })
    const secondRead = adapter.readObjectInfo({ endpoint: "http://127.0.0.1:8000" })
    await vi.waitFor(() => expect(started).toBe(1))
    releaseFirst()
    await Promise.all([firstRead, secondRead])
    expect(started).toBe(2)
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
