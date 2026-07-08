import { describe, expect, test } from "vitest"
import { buildCommandPlans, buildJellyPotDatabase, buildJellyPotRunRecord, normalizeJellyPotInput, normalizeMediaPath, runJellyPot, runJellypot } from "./core.js"

describe("jellypot core", () => {
  test("normalizes potplayer URLs", () => {
    expect(normalizeMediaPath("potplayer://D%3A//media/test.mkv")).toBe("D:\\media\\test.mkv")
  })

  test("builds launch command", () => {
    const plans = buildCommandPlans({ potplayer: { executable_path: "P.exe" } }, {
      action: "launch_media",
      configPath: "",
      configText: "",
      databasePath: "",
      recordRun: false,
      mediaPath: "D:/a.mkv",
      potplayerPath: "",
      browserPath: "",
      dryRun: false,
    }, { dirname: (path) => path, join: (...parts) => parts.join("\\") })
    expect(plans[0]?.command).toBe("P.exe")
    expect(plans[0]?.args[0]).toBe("D:\\a.mkv")
  })

  test("builds default JSONL database path", () => {
    const database = buildJellyPotDatabase(normalizeJellyPotInput({ configPath: "D:/JellyPot/config.json" }))
    expect(database).toEqual({
      path: "D:/JellyPot/.xiranite/jellypot-runs.jsonl",
      enabled: false,
      mode: "jsonl",
      defaultPath: true,
    })
  })

  test("summarizes run records", () => {
    const input = normalizeJellyPotInput({ action: "launch_media", mediaPath: "potplayer://D%3A//media/test.mkv", dryRun: true })
    const commands = buildCommandPlans({ potplayer: { executable_path: "P.exe" } }, input, { dirname: (path) => path, join: (...parts) => parts.join("\\") })
    const record = buildJellyPotRunRecord("launch_media", input, {}, [{ name: "potplayer", path: "P.exe", exists: true }], commands)
    expect(record).toMatchObject({
      toolId: "jellypot",
      action: "launch_media",
      dryRun: true,
      normalizedMediaPath: "D:\\media\\test.mkv",
      commandCount: 1,
      success: true,
    })
  })

  test("loads status through injected runtime", async () => {
    const result = await runJellyPot({
      configText: JSON.stringify({ potplayer: { executable_path: "P.exe" } }),
    }, {
      readText: async () => "",
      appendRecord: async () => {},
      pathExists: async () => true,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      dirname: (path) => path,
      join: (...parts) => parts.join("\\"),
    })
    expect(result.success).toBe(true)
    expect(result.data?.checks[0]?.name).toBe("potplayer")
    expect(result.data?.database).toBeUndefined()
  })

  test("records status when enabled", async () => {
    const records: Array<{ path: string; record: unknown }> = []
    const result = await runJellyPot({
      action: "status",
      configPath: "D:/JellyPot/config.json",
      configText: JSON.stringify({ potplayer: { executable_path: "P.exe" } }),
      recordRun: true,
    }, {
      readText: async () => "",
      appendRecord: async (path, record) => {
        records.push({ path, record })
      },
      pathExists: async () => false,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      dirname: (path) => path.replace(/[/\\][^/\\]+$/, ""),
      join: (...parts) => parts.join("\\"),
    })
    expect(result.success).toBe(true)
    expect(result.data?.database?.path).toBe("D:/JellyPot/.xiranite/jellypot-runs.jsonl")
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/JellyPot/.xiranite/jellypot-runs.jsonl")
    expect(records[0]?.record).toMatchObject({ toolId: "jellypot", action: "status", commandCount: 0 })
  })

  test("exports generated runner alias", () => {
    expect(runJellypot).toBe(runJellyPot)
  })
})
