import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { resolveSuperResolutionArtifactCacheRoot } from "./SuperResolutionArtifactCacheRoot.js"

describe("resolveSuperResolutionArtifactCacheRoot", () => {
  it("[neoview.super-resolution.xr-cache-root] resolves below the configured Xiranite data directory", () => {
    const root = "D:/isolated-xiranite"
    expect(resolveSuperResolutionArtifactCacheRoot({
      cwd: "D:/workspace",
      env: { XIRANITE_DATA_DIR: root },
    })).toBe(join(root, "nodes", "neoview", "upscale-artifacts"))
  })

  it("[neoview.super-resolution.xr-cache-root] follows an explicit Xiranite config path", () => {
    expect(resolveSuperResolutionArtifactCacheRoot({
      cwd: "D:/workspace",
      configPath: "D:/portable/xiranite.config.toml",
      env: {},
    })).toBe(join("D:/portable", "nodes", "neoview", "upscale-artifacts"))
  })
})
