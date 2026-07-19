import { describe, expect, it } from "vitest"

import {
  DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG,
  parseNeoviewSuperResolutionPreferencesPatch,
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
      customModels: [],
      preferences: DEFAULT_NEOVIEW_SUPER_RESOLUTION_CONFIG.preferences,
    })
  })

  it("[neoview.super-resolution.preferences-config] parses versioned preferences and conditions", () => {
    expect(parseNeoviewRuntimeConfig({ super_resolution: { preferences: {
      schema_version: 1,
      auto_upscale_enabled: true,
      default_model_id: "realcugan",
      default_scale: 3,
      conditional_enabled: true,
      conditions: [{
        id: "small-page",
        name: "Small page",
        enabled: true,
        priority: 0,
        match: { max_width: 1_024, dimension_mode: "and" },
        action: { model_id: "realcugan", scale: 3, skip: false },
      }],
    } } }).superResolution.preferences).toMatchObject({
      schemaVersion: 1,
      autoUpscaleEnabled: true,
      defaultModelId: "realcugan",
      defaultScale: 3,
      conditionalEnabled: true,
      conditions: [{
        id: "small-page",
        match: { maxWidth: 1_024, dimensionMode: "and" },
        action: { modelId: "realcugan", scale: 3, skip: false },
      }],
    })
  })

  it("[neoview.super-resolution.progressive-settings-http] validates the GUI preference patch and emits canonical TOML", () => {
    expect(parseNeoviewSuperResolutionPreferencesPatch({
      superResolution: { preferences: { progressiveEnabled: true, progressiveDwellTimeMs: 5_000, progressiveMaxPages: 999 } },
    })).toEqual({
      patch: { superResolution: { preferences: { progressiveEnabled: true, progressiveDwellTimeMs: 5_000, progressiveMaxPages: 999 } } },
      tomlPatch: { super_resolution: { preferences: { progressive_enabled: true, progressive_dwell_time_ms: 5_000, progressive_max_pages: 999 } } },
    })
    expect(() => parseNeoviewSuperResolutionPreferencesPatch({ superResolution: { preferences: { backgroundConcurrency: 0 } } })).toThrow("between 1 and 32")
  })

  it("[neoview.super-resolution.custom-model-config] validates portable NCNN manifests", () => {
    const checksum = "a".repeat(64)
    expect(parseNeoviewRuntimeConfig({ super_resolution: { custom_models: [{
      id: "illustration-janai",
      type: "upscale",
      name: "IllustrationJaNai",
      engine: "upscayl",
      scales: [4, 2, 2],
      noise: [1, 0, 0],
      latency: 2.2,
      directory: "illustration-janai",
      files: ["model.param", "model.bin"],
      scale_files: { 2: "illustration-janai-x2", 4: "illustration-janai-x4" },
      license: "MIT",
      checksums: { "model.param": checksum, "model.bin": checksum.toUpperCase() },
      input_blob: "in0",
      output_blob: "out0",
      download_base_url: "https://models.example.test/illustration-janai",
    }] } }).superResolution.customModels).toEqual([{
      id: "illustration-janai",
      type: "upscale",
      displayName: "IllustrationJaNai",
      engine: "upscayl",
      scales: [2, 4],
      noise: [0, 1],
      latency: 2.2,
      modelDirectory: "illustration-janai",
      modelFiles: ["model.param", "model.bin"],
      scaleFiles: { 2: "illustration-janai-x2", 4: "illustration-janai-x4" },
      license: "MIT",
      checksums: { "model.param": checksum, "model.bin": checksum },
      inputBlob: "in0",
      outputBlob: "out0",
      downloadBaseUrl: "https://models.example.test/illustration-janai/",
    }])
  })

  it("[neoview.super-resolution.config-validation] rejects invalid providers, paths and budgets", () => {
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { provider: "rust" } })).toThrow("provider")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { upscayl_path: "\0" } })).toThrow("without NUL")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { max_daemons_per_gpu: 9 } })).toThrow("between 0 and 8")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { task_timeout_ms: 1 } })).toThrow("between 1000")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { custom_models: [{ id: "bad", name: "bad", engine: "upscayl", scales: [2], directory: "../bad", files: ["m.bin"], license: "MIT", checksums: { "m.bin": "0".repeat(64) }, input_blob: "in0", output_blob: "out0" }] } })).toThrow("safe relative path")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { custom_models: [{ id: "bad", name: "bad", engine: "upscayl", scales: [2], directory: "bad", files: ["m.bin"], license: "MIT", checksums: { "m.bin": "0".repeat(64), "extra.bin": "1".repeat(64) }, input_blob: "in0", output_blob: "out0" }] } })).toThrow("unknown model file")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { custom_models: [{ id: "bad", name: "bad", engine: "upscayl", scales: [2], scale_files: { 4: "bad-x4" }, directory: "bad", files: ["m.bin"], license: "MIT", checksums: { "m.bin": "0".repeat(64) }, input_blob: "in0", output_blob: "out0" }] } })).toThrow("not a declared scale")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { custom_models: [{ id: "bad", name: "bad", engine: "upscayl", scales: [2], directory: "bad", files: ["m.bin"], license: "MIT", checksums: { "m.bin": "0".repeat(64) }, input_blob: "in0", output_blob: "out0", download_base_url: "http://example.test/models" }] } })).toThrow("HTTPS URL")
    expect(() => parseNeoviewRuntimeConfig({ super_resolution: { preferences: { schema_version: 1, conditions: [{ id: "bad", name: "bad", enabled: true, priority: 0, match: { book_path_regex: "[" }, action: { skip: true } }] } } })).toThrow("regular expression")
  })
})
