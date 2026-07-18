import { describe, expect, it } from "vitest"

import { buildSuperResolutionArtifactKey } from "./SuperResolutionArtifactKey.js"

describe("buildSuperResolutionArtifactKey", () => {
  it("[neoview.super-resolution.artifact-key] is stable and covers source, model, and execution profile", () => {
    const input = {
      sourceIdentity: "D:/books/one.cbz",
      sourceRevision: "size:10:mtime:20:crc:30",
      pageIdentity: "page/001.png#0",
      modelId: "realesr-animevideov3",
      scale: 4,
      noise: 0,
      tileSize: 256,
      tta: false,
      producerVersion: "opencomic-ai-system-1",
    }
    const key = buildSuperResolutionArtifactKey(input)
    expect(key).toMatch(/^neoview:super-resolution:v1:[A-Za-z0-9_-]{43}$/)
    expect(buildSuperResolutionArtifactKey(input)).toBe(key)
    expect(buildSuperResolutionArtifactKey({ ...input, sourceRevision: "size:11:mtime:20:crc:30" })).not.toBe(key)
    expect(buildSuperResolutionArtifactKey({ ...input, scale: 2 })).not.toBe(key)
    expect(buildSuperResolutionArtifactKey({ ...input, producerVersion: "opencomic-ai-system-2" })).not.toBe(key)
  })
})
