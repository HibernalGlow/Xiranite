import { describe, expect, test } from "vitest"
import { findObsoleteCachePackages, parseCacheFilename, parseScoolpSyncConfig, planScoolpSyncCommands, runScoolp } from "./core.js"

describe("scoolp core", () => {
  test("parses sync config and builds commands", () => {
    const config = parseScoolpSyncConfig(`
[scoop]
root = "D:/scoop"
repo = "https://example.test/scoop"

[options]
remove_all_before_add = false
run_update = false

[[bucket]]
name = "main"
url = "https://example.test/main"
`)
    expect(config.buckets[0]?.name).toBe("main")
    const plan = planScoolpSyncCommands(config)
    expect(plan.some((item) => item.args.includes("SCOOP_REPO"))).toBe(true)
    expect(plan.some((item) => item.label === "scoop update")).toBe(false)
  })

  test("finds obsolete cache packages", () => {
    expect(parseCacheFilename("demo#1.0#abc")).toEqual({ name: "demo", version: "1.0" })
    const scan = findObsoleteCachePackages("cache", [
      { name: "demo#1.0#old", path: "cache/demo#1.0#old", size: 10 },
      { name: "demo#2.0#new", path: "cache/demo#2.0#new", size: 20 },
      { name: "other#1.0#new", path: "cache/other#1.0#new", size: 5 },
    ])
    expect(scan.obsoleteCount).toBe(1)
    expect(scan.obsoletePackages[0]?.version).toBe("1.0")
  })

  test("runs package list through injected runtime", async () => {
    const result = await runScoolp(
      { action: "list_packages", bucketPath: "bucket" },
      {
        commandExists: async () => false,
        runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
        runPowerShell: async () => ({ code: 0, stdout: "", stderr: "" }),
        readText: async () => "",
        listBucketManifests: async () => [{ name: "demo", version: "1.0" }],
        readManifest: async () => null,
        scanCache: async () => [],
        ensureDir: async () => {},
        moveFile: async () => {},
        deleteFile: async () => {},
        env: () => undefined,
        now: () => new Date("2024-01-01T00:00:00Z"),
      },
    )
    expect(result.success).toBe(true)
    expect(result.data?.availablePackages[0]?.name).toBe("demo")
  })
})
