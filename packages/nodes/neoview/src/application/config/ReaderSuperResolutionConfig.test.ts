import { describe, expect, it } from "vitest"

import {
  DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG,
  parseNeoviewRuntimeConfig,
} from "./ReaderRuntimeConfig.js"

describe("NeoView super-resolution runtime config", () => {
  it("[neoview.super-resolution.config-defaults] remains system-capable without probing at parse time", () => {
    expect(parseNeoviewRuntimeConfig(undefined).superResolution).toEqual(DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG)
  })

  it("[neoview.super-resolution.config] reads only [nodes.neoview.super_resolution] values", () => {
    expect(parseNeoviewRuntimeConfig({
      schema_version: 1,
      super_resolution: {
        provider: "opencomic-system",
        upscayl_path: "D:/Tools/upscayl-bin.exe",
        waifu2x_path: "",
        realcugan_path: "D:/Tools/realcugan.exe",
        models_directory: "D:/Models",
        max_daemons_per_gpu: 2,
        daemon_idle_timeout_ms: 120_000,
        task_timeout_ms: 900_000,
      },
    }).superResolution).toEqual({
      provider: "opencomic-system",
      upscaylPath: "D:/Tools/upscayl-bin.exe",
      waifu2xPath: undefined,
      realcuganPath: "D:/Tools/realcugan.exe",
      modelsDirectory: "D:/Models",
      maxDaemonsPerGpu: 2,
      daemonIdleTimeoutMs: 120_000,
      taskTimeoutMs: 900_000,
    })
  })

  it("[neoview.super-resolution.config-validation] rejects invalid providers, paths and budgets", () => {
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { provider: "rust" } })).toThrow("provider")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { upscayl_path: "\0" } })).toThrow("without NUL")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { max_daemons_per_gpu: 9 } })).toThrow("between 0 and 8")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { task_timeout_ms: 1 } })).toThrow("between 1000")
  })
})
