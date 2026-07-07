import { describe, expect, test } from "vitest"
import { buildCommand, buildOwithuPlan, parseOwithuConfig, registryPath, runOwithu } from "./core.js"

const sampleToml = `
[defaults]
enabled = true
hives = ["HKCU"]

[vars]
scoop_root = "D:/scoop"

[[entries]]
key = "VSCode"
label = "Open with Code"
exe = "{scoop_root}/apps/vscode/current/Code.exe"
scope = ["file", "directory", "background"]
args = ["%1"]
`

describe("owithu core", () => {
  test("parses TOML entries with vars and scopes", () => {
    const config = parseOwithuConfig(sampleToml)
    expect(config.entries[0]?.exe).toBe("D:\\scoop\\apps\\vscode\\current\\Code.exe")
    expect(config.entries[0]?.scope).toEqual(["file", "directory", "background"])
  })

  test("builds registry plans and command quoting", () => {
    const config = parseOwithuConfig(sampleToml)
    const plan = buildOwithuPlan(config, { action: "register" })
    expect(plan).toHaveLength(3)
    expect(plan[0]?.registryPath).toBe(registryPath("HKCU", "VSCode", "file"))
    expect(plan.find((item) => item.scope === "directory")?.command).toContain("\"%V\"")
    expect(buildCommand("C:\\Program Files\\app.exe", ["%1"])).toBe("\"C:\\Program Files\\app.exe\" \"%1\"")
  })

  test("runs preview with injected config text", async () => {
    const result = await runOwithu(
      { action: "preview", configText: sampleToml },
      {
        readConfig: async () => "",
        applyRegistryPlan: async () => ({ successCount: 0, failedCount: 0, errors: [] }),
      },
    )
    expect(result.success).toBe(true)
    expect(result.data?.entries[0]?.key).toBe("VSCode")
  })
})
