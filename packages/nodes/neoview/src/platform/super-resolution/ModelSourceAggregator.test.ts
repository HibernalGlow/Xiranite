import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { aggregateModelSources, enrichModelManifests } from "./ModelSourceAggregator.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ModelSourceAggregator", () => {
  it("[neoview.super-resolution.model-sources] aggregates known source packages without modifying them", async () => {
    const root = await temporaryRoot()
    const source = join(root, "sr_vulkan_model_realesrgan")
    const models = join(source, "models")
    const aggregate = join(root, "aggregate")
    await mkdir(models, { recursive: true })
    for (const scale of [2, 3, 4]) {
      await writeFile(join(models, `REALESRGAN_ANIMAVIDEOV3_UP${scale}X.bin`), `bin-${scale}`)
      await writeFile(join(models, `REALESRGAN_ANIMAVIDEOV3_UP${scale}X.param`), `param-${scale}`)
    }

    const result = await aggregateModelSources(aggregate, [source])

    expect(result.metadata.get("realesr-animevideov3")).toMatchObject({
      family: "RealESRGAN",
      category: "anime",
      installed: true,
      sourceDirectories: [source],
    })
    await expect(readFile(join(aggregate, "upscale", "models", "realesr-animevideov3-x2.bin"), "utf8")).resolves.toBe("bin-2")
    await expect(readFile(join(models, "REALESRGAN_ANIMAVIDEOV3_UP2X.bin"), "utf8")).resolves.toBe("bin-2")
  })

  it("[neoview.super-resolution.model-source-custom] registers metadata-rich RealSR models", async () => {
    const root = await temporaryRoot()
    const source = join(root, "realsr")
    const models = join(source, "models")
    const aggregate = join(root, "aggregate")
    await mkdir(models, { recursive: true })
    await writeFile(join(models, "REALSR_DF2K_UP4X.bin"), "model-bin")
    await writeFile(join(models, "REALSR_DF2K_UP4X.param"), "model-param")

    const result = await aggregateModelSources(aggregate, [source])
    const custom = result.customModels.find((model) => model.id === "external-realsr-df2k-x4")

    expect(custom).toMatchObject({
      displayName: "RealSR DF2K x4",
      engine: "upscayl",
      scales: [4],
      scaleFiles: { 4: "realsr-df2k-x4" },
    })
    expect(custom?.checksums["realsr-df2k-x4.bin"]).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.metadata.get("external-realsr-df2k-x4")).toMatchObject({ family: "RealSR", sizeBytes: 20, installed: true })

    const enriched = await enrichModelManifests([{
      id: custom!.id,
      displayName: custom!.displayName,
      engine: custom!.engine,
      scales: custom!.scales,
      modelDirectory: join("upscale", custom!.modelDirectory),
      modelFiles: custom!.modelFiles,
    }], aggregate, result.metadata)
    expect(enriched[0]).toMatchObject({ family: "RealSR", category: "photo", sizeBytes: 20, installed: true })
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-model-sources-"))
  roots.push(root)
  return root
}
