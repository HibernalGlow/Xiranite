/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createScoolpInteractionSchema } from "./interaction.js"
import { ScoolpTui } from "./Tui.js"

test("Scoolp direct TUI renders cache capacity, target list and cleanup rail", async () => {
  const setup = await testRender(<ScoolpTui definition={{
    schema: createScoolpInteractionSchema({ action: "cache_list", cachePath: "D:/scoop/cache", scoopRoot: "D:/scoop" }, "zh"),
    run: async () => ({ success: true, message: "扫描完成", data: {
      scoopInstalled: true, installedPackages: [], buckets: [], availablePackages: [], syncPlan: [], commandResults: [], installedCount: 0, failedCount: 0, cleanedCount: 0, cleanedSizeBytes: 0, errors: [],
      cache: { path: "D:/scoop/cache", fileCount: 4, softwareCount: 2, obsoleteCount: 2, obsoleteSize: 1200, obsoletePackages: [
        { name: "nodejs", version: "20", size: 900, filename: "nodejs#20#old.7z", path: "D:/scoop/cache/nodejs#20#old.7z" },
        { name: "git", version: "2.4", size: 300, filename: "git#2.4#old.7z", path: "D:/scoop/cache/git#2.4#old.7z" },
      ] },
    } }),
  }} language="zh" onExit={() => undefined} />, { width: 142, height: 38, useMouse: true })
  try {
    await act(async () => setup.renderOnce())
    const frame = setup.captureCharFrame()
    expect(frame).toContain("SCOOLP // CACHE DECK")
    expect(frame).toContain("缓存容量分析")
    expect(frame).toContain("可处理项目")
    expect(frame).toContain("清理操作")
    expect(frame).toContain("扫描缓存")
  } finally { await act(async () => setup.renderer.destroy()) }
})
