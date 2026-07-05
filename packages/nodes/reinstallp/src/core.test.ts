import { describe, expect, test } from "bun:test"
import { extractPyprojectName, runReinstallp, shouldExcludePath } from "./core.js"

describe("reinstallp core", () => {
  test("extracts project name from pyproject", () => {
    expect(extractPyprojectName('[project]\nname = "demo-pkg"\n', "fallback")).toBe("demo-pkg")
    expect(extractPyprojectName("[tool.demo]\nname = \"tool\"\n", "fallback")).toBe("fallback")
  })

  test("excludes virtualenv and build folders", () => {
    expect(shouldExcludePath("repo/.venv/pkg")).toBe(true)
    expect(shouldExcludePath("repo/src/pkg")).toBe(false)
  })

  test("runs scan with injected runtime", async () => {
    const result = await runReinstallp(
      { action: "scan", path: "repo" },
      {
        scanProjects: async () => [{ path: "repo/pkg", name: "pkg", pyproject: "repo/pkg/pyproject.toml" }],
        installProject: async () => ({ success: true }),
      },
    )
    expect(result.success).toBe(true)
    expect(result.data?.projects[0]?.name).toBe("pkg")
  })
})
