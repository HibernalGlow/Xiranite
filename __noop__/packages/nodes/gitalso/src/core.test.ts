import { describe, expect, it, vi } from "vitest"
import { parseDinyOutput, runGitalso, type GitalsoRepository, type GitalsoRuntime } from "./core.js"

const repository: GitalsoRepository = {
  root: "D:/repos/selected", branch: "main", files: [], branches: [{ name: "main", current: true }], commits: [], remotes: ["origin"], ahead: 0, behind: 0, stagedDiff: "",
}

function runtime(): GitalsoRuntime {
  return {
    defaultRepoPath: vi.fn(async () => "D:/repos/default"), getRepository: vi.fn(async () => repository),
    stage: vi.fn(), unstage: vi.fn(), stageAll: vi.fn(), unstageAll: vi.fn(), createBranch: vi.fn(), checkoutBranch: vi.fn(), fetch: vi.fn(), pull: vi.fn(), push: vi.fn(async () => ({ remote: "origin", branch: "main" })), commit: vi.fn(async () => ({ hash: "abcdef" })),
    resolveDiny: vi.fn(async () => ({ found: false, path: "", version: null })), runDinyPrint: vi.fn(), gitButlerCommit: vi.fn(async () => ({ hash: "abcdef123456", message: "feat: land change" })),
  }
}

describe("runGitalso", () => {
  it("runs repository status against the explicitly selected working path", async () => {
    const host = runtime()
    const result = await runGitalso({ action: "status", repoPath: "D:/repos/selected" }, host)
    expect(result.success).toBe(true)
    expect(host.getRepository).toHaveBeenCalledWith("D:/repos/selected")
    expect(host.defaultRepoPath).not.toHaveBeenCalled()
  })

  it("uses the default path only when no repository path was supplied", async () => {
    const host = runtime()
    await runGitalso({ action: "status" }, host)
    expect(host.defaultRepoPath).toHaveBeenCalledOnce()
    expect(host.getRepository).toHaveBeenCalledWith("D:/repos/default")
  })

  it("uses GitButler only for the explicit fallback action and keeps its selected path", async () => {
    const host = runtime()
    const result = await runGitalso({ action: "gitbutler_commit", repoPath: "D:/repos/selected" }, host)
    expect(result.success).toBe(true)
    expect(result.data.commitMessage).toBe("feat: land change")
    expect(host.gitButlerCommit).toHaveBeenCalledWith("D:/repos/selected")
    expect(host.resolveDiny).not.toHaveBeenCalled()
  })

  it("never treats diny TUI control output as a commit message", () => {
    expect(parseDinyOutput("\u001b[?25l\u001b[?2004h\ndiny v0.7.8\n◎ waking up...")).toBeNull()
  })
})
