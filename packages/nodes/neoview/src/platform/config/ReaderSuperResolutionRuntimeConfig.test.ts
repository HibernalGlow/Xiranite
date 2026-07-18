import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { loadNeoviewRuntimeConfig } from "./loadNeoviewRuntimeConfig.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("NeoView super-resolution TOML config", () => {
  it("[neoview.super-resolution.toml] loads the node section without consulting a database", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-super-resolution-config-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.super_resolution]",
      'provider = "opencomic-system"',
      'upscayl_path = "D:/Tools/upscayl-bin.exe"',
      'waifu2x_path = ""',
      'realcugan_path = "D:/Tools/realcugan.exe"',
      'models_directory = "D:/Models"',
      "max_daemons_per_gpu = 1",
      "daemon_idle_timeout_ms = 180000",
      "task_timeout_ms = 720000",
      "[[nodes.neoview.super_resolution.custom_models]]",
      'id = "illustration-janai"',
      'name = "IllustrationJaNai"',
      'engine = "upscayl"',
      "scales = [2]",
      'directory = "illustration-janai"',
      'files = ["model.param", "model.bin"]',
      'license = "MIT"',
      `checksums = { "model.param" = "${"a".repeat(64)}", "model.bin" = "${"b".repeat(64)}" }`,
      'input_blob = "in0"',
      'output_blob = "out0"',
      "",
    ].join("\n"), "utf8")

    await expect(loadNeoviewRuntimeConfig({ configPath })).resolves.toMatchObject({
      superResolution: {
        provider: "opencomic-system",
        upscaylPath: "D:/Tools/upscayl-bin.exe",
        waifu2xPath: undefined,
        realcuganPath: "D:/Tools/realcugan.exe",
        modelsDirectory: "D:/Models",
        maxDaemonsPerGpu: 1,
        daemonIdleTimeoutMs: 180_000,
        taskTimeoutMs: 720_000,
        customModels: [{
          id: "illustration-janai",
          displayName: "IllustrationJaNai",
          engine: "upscayl",
          scales: [2],
          modelDirectory: "illustration-janai",
          modelFiles: ["model.param", "model.bin"],
        }],
      },
    })
  })
})
