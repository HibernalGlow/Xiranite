import { describe, expect, it } from "vitest"

import {
  ANIMA_INT8_RECIPE,
  COMFYGURE_BINDING_MANIFEST_FORMAT,
  COMFYGURE_TEMPLATE_FORMAT,
  compressComfygureText,
  createComfygureProfile,
  type ComfygureTemplate,
  type PromptGraph,
} from "./core.js"
import {
  COMFYGURE_BROTLI_QUALITY,
  COMFYGURE_CONTENT_COMPRESSION_THRESHOLD,
  assertSupportedComfygureRecipe,
  createComfygureJsonBlob,
  createComfygureProjectDocument,
  createComfygureResolvedProfileSnapshot,
  createComfygureTextBlob,
  hashComfygureJson,
  materializeComfygureProjectTemplate,
  parseComfygureProjectDocument,
  readComfygureJsonBlob,
  readComfygureTextBlob,
} from "./project.js"

describe("Comfygure Project Document", () => {
  it("canonicalizes JSON before calculating stable SHA-256 identities", () => {
    const first = hashComfygureJson({ z: [3, { beta: true, alpha: false }], a: 1 })
    const second = hashComfygureJson({ a: 1, z: [3, { alpha: false, beta: true }] })

    expect(first).toBe(second)
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it("stores small content directly and large content with Brotli quality 4", async () => {
    const small = await createComfygureTextBlob("small prompt")
    const largeSource = "masterpiece, detailed portrait, cinematic light\n".repeat(500)
    expect(Buffer.byteLength(largeSource)).toBeGreaterThan(COMFYGURE_CONTENT_COMPRESSION_THRESHOLD)
    const large = await createComfygureTextBlob(largeSource)
    const duplicate = await createComfygureTextBlob(largeSource)

    expect(small).toMatchObject({ codec: "identity", rawSize: 12, storedSize: 12 })
    expect(large).toMatchObject({ codec: "brotli", brotliQuality: COMFYGURE_BROTLI_QUALITY })
    expect(large.storedSize).toBeLessThan(large.rawSize)
    expect(duplicate.hash).toBe(large.hash)
    await expect(readComfygureTextBlob(large)).resolves.toBe(largeSource)
  })

  it("verifies content size and hash while decoding", async () => {
    const blob = await createComfygureJsonBlob({ prompt: "cat", seed: 42 })
    await expect(readComfygureJsonBlob({ ...blob, rawSize: blob.rawSize + 1 })).rejects.toThrow("raw size")
    const replacement = blob.data.startsWith("A") ? "B" : "A"
    await expect(readComfygureJsonBlob({ ...blob, data: `${replacement}${blob.data.slice(1)}` })).rejects.toThrow()
  })

  it("freezes profile source identity, exact version and resolved content hash", () => {
    const profile = createComfygureProfile({ parameters: { width: 1536, height: 896 } }, "ANIMA Portrait", {
      now: new Date("2026-07-24T00:00:00.000Z"),
    })
    const snapshot = createComfygureResolvedProfileSnapshot(profile, { kind: "built-in", version: "1.4.0" }, new Date("2026-07-24T01:00:00.000Z"))

    expect(snapshot).toMatchObject({
      source: { kind: "built-in", id: "anima-portrait", version: "1.4.0" },
      resolvedAt: "2026-07-24T01:00:00.000Z",
      profile: { parameters: { width: 1536, height: 896 } },
    })
    expect(snapshot.contentHash).toBe(hashComfygureJson(snapshot.profile))
  })

  it("round-trips a self-contained project with compressed import snapshots", async () => {
    const graph = largePromptGraph()
    const originalSource = JSON.stringify(graph, null, 2)
    const template: ComfygureTemplate = {
      format: COMFYGURE_TEMPLATE_FORMAT,
      name: "ANIMA imported API",
      sourceFormat: "api",
      originalSource: compressComfygureText(originalSource)!,
      repairedSource: false,
      graph,
      defaultLoras: [{ name: "style.safetensors", modelStrength: 0.8 }],
      bindingManifest: {
        format: COMFYGURE_BINDING_MANIFEST_FORMAT,
        confirmed: true,
        bindings: [{ key: "positivePrompt", confidence: "explicit", targets: [{ nodeId: "1", inputName: "text" }] }],
      },
    }
    const profile = createComfygureProfile({ model: { unetName: "anima-int8.safetensors" } }, "ANIMA INT8", {
      now: new Date("2026-07-24T00:00:00.000Z"),
    })
    const project = await createComfygureProjectDocument({
      name: "Storyboard",
      prompts: { positive: "cat ears" },
      batch: { entries: [{ text: "scene one", sourceName: "001.txt", sourcePath: "D:/prompts/001.txt" }] },
    }, {
      id: "project-001",
      profile,
      profileSource: { kind: "local", version: "2" },
      profileOverrides: { parameters: { steps: 30 } },
      template,
      now: new Date("2026-07-24T02:00:00.000Z"),
    })

    expect(project).toMatchObject({
      id: "project-001",
      recipe: { id: "anima-int8", version: 1 },
      compiler: { package: "@xiranite/node-comfygure", version: "0.1.0" },
      profileOverrides: { parameters: { steps: 30 } },
      program: { recipe: ANIMA_INT8_RECIPE, prompts: { positive: "cat ears" } },
    })
    expect(project).not.toHaveProperty("target")
    expect(project.template?.originalSource).toMatchObject({ codec: "brotli", brotliQuality: 4 })
    expect(project.template?.normalizedGraph).toMatchObject({ codec: "brotli", brotliQuality: 4 })

    const loaded = await parseComfygureProjectDocument(JSON.parse(JSON.stringify(project)))
    const materialized = await materializeComfygureProjectTemplate(loaded.template!)
    expect(materialized.graph).toEqual(graph)
    expect(materialized.bindingManifest).toEqual(template.bindingManifest)
    assertSupportedComfygureRecipe(loaded)
  })

  it("fails closed on profile drift, unknown project fields and missing recipes", async () => {
    const profile = createComfygureProfile({}, "ANIMA INT8")
    const project = await createComfygureProjectDocument({}, { profile, id: "project-002" })
    const drifted = structuredClone(project)
    drifted.resolvedProfile.profile.model.unetName = "silently-changed.safetensors"
    await expect(parseComfygureProjectDocument(drifted)).rejects.toThrow("content hash")
    await expect(parseComfygureProjectDocument({ ...project, endpoint: "http://127.0.0.1:8000" })).rejects.toThrow()
    expect(() => assertSupportedComfygureRecipe({ recipe: { id: "future-anima", version: 9 } })).toThrow("not installed")
  })
})

function largePromptGraph(): PromptGraph {
  return Object.fromEntries(Array.from({ length: 140 }, (_, index) => {
    const id = String(index + 1)
    return [id, {
      class_type: index === 139 ? "SaveImagePlus" : "CLIPTextEncode",
      inputs: index === 139
        ? { images: ["139", 0], filename_prefix: "comfygure/test" }
        : { text: `prompt ${index} ${"detail ".repeat(12)}`, clip: index === 0 ? ["140", 0] : [String(index), 0] },
    }]
  }))
}
