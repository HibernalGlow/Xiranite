import { describe, expect, test } from "vitest"
import { buildCommandPlans, normalizeMediaPath, runJellyPot } from "./core.js"

describe("jellypot core", () => {
  test("normalizes potplayer URLs", () => {
    expect(normalizeMediaPath("potplayer://D%3A//media/test.mkv")).toBe("D:\\media\\test.mkv")
  })

  test("builds launch command", () => {
    const plans = buildCommandPlans({ potplayer: { executable_path: "P.exe" } }, {
      action: "launch_media",
      configPath: "",
      configText: "",
      mediaPath: "D:/a.mkv",
      potplayerPath: "",
      browserPath: "",
      dryRun: false,
    }, { dirname: (path) => path, join: (...parts) => parts.join("\\") })
    expect(plans[0]?.command).toBe("P.exe")
    expect(plans[0]?.args[0]).toBe("D:\\a.mkv")
  })

  test("loads status through injected runtime", async () => {
    const result = await runJellyPot({
      configText: JSON.stringify({ potplayer: { executable_path: "P.exe" } }),
    }, {
      readText: async () => "",
      pathExists: async () => true,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      dirname: (path) => path,
      join: (...parts) => parts.join("\\"),
    })
    expect(result.success).toBe(true)
    expect(result.data?.checks[0]?.name).toBe("potplayer")
  })
})
