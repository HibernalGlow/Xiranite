import { describe, expect, it } from "vitest"

import { parseSuperResolutionPreferences } from "../../domain/super-resolution/super-resolution-preferences.js"
import { SuperResolutionPolicyService } from "./SuperResolutionPolicyService.js"

const input = {
  trigger: "automatic-current" as const,
  width: 800,
  height: 1_200,
  bookPath: "D:\\Library\\02COS\\book.cbz",
  imagePath: "D:\\Cache\\page-001.png",
  innerPath: "chapter/cover.png",
  createdAt: 100,
  modifiedAt: 200,
  metadata: { rating: 4.5, artist: "alice and bob" },
}

describe("SuperResolutionPolicyService", () => {
  it("[neoview.super-resolution.policy-default] resolves defaults without starting a provider", () => {
    const policy = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: true,
      default_model_id: "realesr-animevideov3",
      default_scale: 2,
      default_tile_enabled: true,
      default_tile_size: 256,
      default_noise: 0,
      default_gpu_id: "1",
    }))

    expect(policy.decide(input)).toEqual({
      kind: "run",
      reason: "default-policy",
      modelId: "realesr-animevideov3",
      scale: 2,
      noise: 0,
      tileSize: 256,
      tta: undefined,
      gpuId: "1",
      useCache: true,
      conditionId: undefined,
      conditionName: undefined,
    })
  })

  it("[neoview.super-resolution.policy-priority] selects the first enabled matching condition", () => {
    const policy = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: true,
      conditional_enabled: true,
      default_model_id: "realesr-animevideov3",
      default_scale: 2,
      conditions: [condition("later", 10, { min_width: 1 }, { model_id: "realcugan", scale: 4 }), condition(
        "cos",
        1,
        {
          max_width: 1_024,
          max_megapixels: 1,
          book_path_regex: "(?:^|/)02COS(?:/|$)",
          image_path_regex: "^chapter/",
          match_inner_path: true,
          metadata: {
            rating: { operator: "gte", value: 4 },
            artist: { operator: "contains", value: "alice" },
          },
        },
        { model_id: "realesrgan-x4plus-anime", scale: 4, tile_enabled: false, use_cache: false },
      )],
    }))

    expect(policy.decide(input)).toMatchObject({
      kind: "run",
      reason: "condition-match",
      conditionId: "cos",
      modelId: "realesrgan-x4plus-anime",
      scale: 4,
      tileSize: undefined,
      useCache: false,
    })
  })

  it("[neoview.super-resolution.policy-skip] honors skip and preload exclusion actions", () => {
    const skip = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: true,
      conditional_enabled: true,
      conditions: [condition("large", 0, { min_width: 700 }, { skip: true })],
    }))
    expect(skip.decide(input)).toMatchObject({ kind: "skip", reason: "condition-skip", conditionId: "large" })

    const preload = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: true,
      pre_upscale_enabled: true,
      conditional_enabled: true,
      conditions: [condition("current-only", 0, { exclude_from_preload: true }, { model_id: "realcugan", scale: 2 })],
    }))
    expect(preload.decide({ ...input, trigger: "preload" })).toMatchObject({
      kind: "skip",
      reason: "condition-excludes-preload",
      conditionId: "current-only",
    })
  })

  it("[neoview.super-resolution.policy-trigger] separates auto/preload switches from explicit manual runs", () => {
    const policy = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: false,
      pre_upscale_enabled: false,
      default_model_id: "realcugan",
      default_scale: 2,
    }))
    expect(policy.decide(input)).toEqual({ kind: "disabled", reason: "automatic-upscale-disabled" })
    expect(policy.decide({ ...input, trigger: "manual" })).toMatchObject({ kind: "run", modelId: "realcugan" })

    const conditionalMinimum = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: true,
      conditional_enabled: true,
      conditional_min_width: 1_000,
      conditional_min_height: 1_000,
      default_model_id: "realcugan",
      default_scale: 2,
    }))
    expect(conditionalMinimum.decide(input)).toEqual({ kind: "skip", reason: "below-conditional-minimum" })
    expect(conditionalMinimum.decide({ ...input, trigger: "manual" })).toMatchObject({ kind: "run" })
  })

  it("[neoview.super-resolution.policy-metadata] requires configured timestamps and evaluates regex metadata", () => {
    const policy = new SuperResolutionPolicyService(preferences({
      auto_upscale_enabled: true,
      conditional_enabled: true,
      conditions: [condition("dated", 0, {
        created_between: [50, 150],
        metadata: { artist: { operator: "regex", value: "^alice" } },
      }, { model_id: "realcugan", scale: 2 })],
      default_model_id: "realesr-animevideov3",
      default_scale: 2,
    }))
    expect(policy.decide(input)).toMatchObject({ kind: "run", conditionId: "dated", modelId: "realcugan" })
    expect(policy.decide({ ...input, createdAt: undefined })).toMatchObject({
      kind: "run",
      reason: "default-policy",
      modelId: "realesr-animevideov3",
    })
  })

  it("[neoview.super-resolution.policy-validation] rejects invalid requests and cache budgets", () => {
    expect(() => new SuperResolutionPolicyService(preferences({}), { regexCacheSize: 0 })).toThrow("between 1 and 4096")
    const policy = new SuperResolutionPolicyService(preferences({}))
    expect(() => policy.decide({ ...input, width: 0 })).toThrow("width")
    expect(() => policy.decide({ ...input, imagePath: " " })).toThrow("image path")
  })
})

function preferences(value: Record<string, unknown>) {
  return parseSuperResolutionPreferences({ schema_version: 1, ...value })
}

function condition(
  id: string,
  priority: number,
  match: Record<string, unknown>,
  action: Record<string, unknown>,
) {
  return { id, name: id, enabled: true, priority, match, action }
}
