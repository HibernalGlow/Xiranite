import { describe, expect, it, vi } from "vitest"
import { runGitalso, type DinyRuntime } from "./core.js"

describe("runGitalso", () => {
  it("uses GitButler only for the explicit landing action", async () => {
    const gitButlerCommit = vi.fn(async () => ({ hash: "abcdef123456", message: "feat: land change" }))
    const runtime = {
      resolveDiny: vi.fn(),
      runDinyPrint: vi.fn(),
      getStagedFiles: vi.fn(),
      getStagedDiff: vi.fn(),
      getDiffStat: vi.fn(),
      getCurrentBranch: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      gitButlerCommit,
    } as unknown as DinyRuntime

    const result = await runGitalso({ action: "gitbutler_commit", repoPath: "C:/repo" }, runtime)

    expect(result.success).toBe(true)
    expect(result.data.commitMessage).toBe("feat: land change")
    expect(gitButlerCommit).toHaveBeenCalledWith("C:/repo")
    expect(runtime.resolveDiny).not.toHaveBeenCalled()
  })
})
