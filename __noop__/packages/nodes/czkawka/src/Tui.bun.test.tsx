/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test, vi } from "vitest"
import { act } from "react"
import { createCzkawkaInteractionSchema } from "./interaction.js"
import { CzkawkaTui } from "./Tui.js"

test("Czkawka TUI renders eleven scanners and responds to mouse", async () => {
  const schema = createCzkawkaInteractionSchema({ includedDirectoriesText: "D:/media" }, "zh")
  const screen = await testRender(<CzkawkaTui definition={{ schema, run: async () => ({ success: true, message: "done", data: { action: "scan", tool: "duplicate-files", groups: [], entries: [], messages: "", stopped: false, groupCount: 0, fileCount: 0, totalBytes: 0, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 } }) }} language="zh" onExit={() => undefined} />, { width: 150, height: 42, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("CZKAWKA // FILE FORENSICS")
    expect(screen.captureCharFrame()).toContain("相似图片")
    expect(screen.captureCharFrame()).toContain("扫描")
    const tabs = screen.renderer.root.findDescendantById("czkawka-input-tabs")
    expect(tabs).toBeDefined()
    await act(async () => screen.mockMouse.click(tabs!.x + Math.max(1, Math.floor(tabs!.width / 2)), tabs!.y))
    expect(createCzkawkaInteractionSchema({ action: "move", selectedPathsText: "D:/a.bin", destinationDirectory: "E:/Review", copyMode: true }, "zh").toInput({ action: "move", tool: "duplicate-files", selectedPathsText: "D:/a.bin", destinationDirectory: "E:/Review", copyMode: true })).toMatchObject({ action: "move", copyMode: true, selectedPaths: ["D:/a.bin"] })
  } finally { await act(async () => screen.renderer.destroy()) }
})

test("Czkawka TUI renders the complete workbench in English", async () => {
  const schema = createCzkawkaInteractionSchema({ includedDirectoriesText: "D:/media" }, "en")
  const screen = await testRender(<CzkawkaTui definition={{ schema, run: async () => ({ success: true, message: "done", data: { action: "scan", tool: "duplicate-files", groups: [], entries: [], messages: "", stopped: false, groupCount: 0, fileCount: 0, totalBytes: 0, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 } }) }} language="en" onExit={() => undefined} />, { width: 170, height: 46 })
  try {
    await act(async () => screen.renderOnce())
    const frame = screen.captureCharFrame()
    expect(frame).toContain("All 11 scanners")
    expect(frame).toContain("Duplicate Files")
    expect(frame).toContain("Directories")
    expect(frame).toContain("RESULT GROUPS")
    expect(frame).toContain("Choose a scanner and directories")
    expect(frame).not.toMatch(/[\u4e00-\u9fff]/)
  } finally { await act(async () => screen.renderer.destroy()) }
})

test("Czkawka TUI selects results, exposes media metadata, and opens the active path", async () => {
  const openPath = vi.fn(async () => undefined)
  const entry = { id: "media-1", groupId: 0, path: "D:/media/track.flac", name: "track.flac", size: 2048, modifiedDate: 10, width: 1920, height: 1080, similarity: "3", title: "Terminal Song", artist: "CLI Artist", genre: "Synth", year: "2026", length: "03:15", bitrate: 320, hash: "abc", detail: "fingerprint match" }
  const schema = createCzkawkaInteractionSchema({ tool: "duplicate-music", includedDirectoriesText: "D:/media" }, "zh")
  const screen = await testRender(<CzkawkaTui definition={{ schema, openPath, run: async () => ({ success: true, message: "scan done", data: { action: "scan", tool: "duplicate-music", groups: [{ id: 0, entries: [entry], totalBytes: 2048, reclaimableBytes: 0 }], entries: [entry], messages: "", stopped: false, groupCount: 1, fileCount: 1, totalBytes: 2048, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 } }) }} language="zh" onExit={() => undefined} />, { width: 170, height: 46, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    await click(screen, "czkawka-command-scan")
    expect(screen.captureCharFrame()).toContain("track.flac")
    await click(screen, "czkawka-result-media-1")
    const frame = screen.captureCharFrame()
    expect(frame).toContain("Terminal Song")
    expect(frame).toContain("CLI Artist")
    expect(frame).toContain("1920×1080")
    expect(frame).toContain("已选")
    await click(screen, "czkawka-result-tabs-selected")
    expect(screen.captureCharFrame()).toContain("track.flac")
    await click(screen, "czkawka-open-active")
    expect(openPath).toHaveBeenCalledWith("D:/media/track.flac")
  } finally { await act(async () => screen.renderer.destroy()) }
})

test("Czkawka TUI renders detailed operation outcomes and logs", async () => {
  const entry = { id: "op-1", groupId: 0, path: "D:/media/a.jpg", name: "a.jpg", size: 10, modifiedDate: 1, secondaryPath: "E:/Review/a (1).jpg", status: "planned" as const, operation: "move" as const, conflictPolicy: "rename" as const }
  const schema = createCzkawkaInteractionSchema({ action: "move", selectedPathsText: entry.path, destinationDirectory: "E:/Review", conflictPolicy: "rename", dryRun: true }, "zh")
  const screen = await testRender(<CzkawkaTui definition={{ schema, run: async (_input, onEvent) => { onEvent({ type: "progress", progress: 50, message: "planning move" }); return { success: true, message: "move planned", data: { action: "move", tool: "similar-images", groups: [{ id: 0, entries: [entry], totalBytes: 10, reclaimableBytes: 0 }], entries: [entry], messages: "", stopped: false, groupCount: 1, fileCount: 1, totalBytes: 10, reclaimableBytes: 0, affectedCount: 1, errorCount: 0 } } } }} language="zh" onExit={() => undefined} />, { width: 170, height: 46, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    await click(screen, "czkawka-command-move")
    expect(screen.captureCharFrame()).toContain("a (1).jpg")
    await click(screen, "czkawka-inspector-tabs-operation")
    expect(screen.captureCharFrame()).toContain("planned")
    expect(screen.captureCharFrame()).toContain("E:/Review/a (1).jpg")
    await click(screen, "czkawka-inspector-tabs-logs")
    expect(screen.captureCharFrame()).toContain("planning move")
  } finally { await act(async () => screen.renderer.destroy()) }
})

async function click(screen: Awaited<ReturnType<typeof testRender>>, id: string) {
  const target = screen.renderer.root.findDescendantById(id)
  expect(target).toBeDefined()
  await act(async () => screen.mockMouse.click(target!.x + Math.max(1, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2))))
  await act(async () => screen.flush())
}
