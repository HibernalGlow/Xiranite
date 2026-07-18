/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createLoratInteractionSchema } from "./interaction.js"
import { LoratTui } from "./Tui.js"

test("LoRaT filters its editable model table and runs scan with one command click", async () => {
  let action: string | undefined
  let selectedKeys: string[] | undefined
  const schema = createLoratInteractionSchema({ folderPath: "D:/loras" }, "zh")
  const rows = [
    { key: "missing", name: "missing.safetensors", stem: "missing", filePath: "D:/loras/missing.safetensors", relativeDir: "", relativePath: "missing.safetensors", pathParts: [], status: "missing" as const, originalStatus: "missing" as const, trigger: "", originalTrigger: "", source: "scan", dbKey: "", changed: false },
    { key: "ready", name: "ready.safetensors", stem: "ready", filePath: "D:/loras/ready.safetensors", relativeDir: "", relativePath: "ready.safetensors", pathParts: [], status: "trigger" as const, originalStatus: "trigger" as const, trigger: "ready token", originalTrigger: "ready token", source: "sidecar", dbKey: "", changed: false },
  ]
  const screen = await testRender(<LoratTui definition={{ schema, run: async (input) => { action = input.action; selectedKeys = input.selectedKeys; return { success: true, message: "ok", data: { folderPath: "D:/loras", rows, stats: { total: 2, missing: 1, trigger: 1, notrigger: 0, changed: 0, selected: 0, dbMatched: 0 }, triggerDbJson: "{}", writtenCount: 0, skippedCount: 0, errors: [], collection: [] } } } }} language="zh" onExit={() => undefined} />, { width: 142, height: 38, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    const first = screen.captureCharFrame()
    expect(first).toContain("LORAT // MODEL SIGNAL MATRIX")
    expect(first).toContain("模型表格")
    expect(first).toContain("状态遥测")
    const button = screen.renderer.root.findDescendantById("lorat-command-scan")
    expect(button).toBeDefined()
    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + 1))
    await screen.waitFor(() => action === "scan")
    await screen.waitFor(() => screen.captureCharFrame().includes("ready.safetensors"))
    const missingFilter = screen.renderer.root.findDescendantById("field-statusFilter-missing")
    expect(missingFilter).toBeDefined()
    await act(async () => screen.mockMouse.click(missingFilter!.x + Math.max(1, Math.floor(missingFilter!.width / 2)), missingFilter!.y + Math.max(0, Math.floor((missingFilter!.height - 1) / 2))))
    await screen.waitFor(() => !screen.captureCharFrame().includes("ready.safetensors"))
    expect(screen.captureCharFrame()).toContain("missing.safetensors")
    const allFilter = screen.renderer.root.findDescendantById("field-statusFilter-all")!
    await act(async () => screen.mockMouse.click(allFilter.x + Math.max(1, Math.floor(allFilter.width / 2)), allFilter.y + Math.max(0, Math.floor((allFilter.height - 1) / 2))))
    await screen.waitFor(() => screen.captureCharFrame().includes("ready.safetensors"))
    const searchField = screen.renderer.root.findDescendantById("field-search")
    expect(searchField).toBeDefined()
    await act(async () => screen.mockMouse.click(searchField!.x + 2, searchField!.y + 1))
    await act(async () => screen.mockInput.typeText("missing"))
    await screen.waitFor(() => !screen.captureCharFrame().includes("ready.safetensors"))
    expect(screen.captureCharFrame()).toContain("missing.safetensors")
    const triggerCell = screen.renderer.root.findDescendantById("trigger-cell-missing")
    expect(triggerCell).toBeDefined()
    await act(async () => screen.mockMouse.click(triggerCell!.x + 2, triggerCell!.y + 1))
    await act(async () => screen.mockInput.typeText("new trigger"))
    await screen.waitFor(() => screen.captureCharFrame().includes("new trigger"))
    const rowWrite = screen.renderer.root.findDescendantById("write-row-missing")
    expect(rowWrite).toBeDefined()
    expect(rowWrite!.x).toBeLessThan(90)
    await act(async () => screen.mockMouse.click(rowWrite!.x + Math.max(1, Math.floor(rowWrite!.width / 2)), rowWrite!.y + Math.max(0, Math.floor((rowWrite!.height - 1) / 2))))
    await act(async () => screen.flush())
    expect(screen.captureCharFrame()).toContain("确认写入")
    const confirm = screen.renderer.root.findDescendantById("confirm-execute")!
    await act(async () => screen.mockMouse.click(confirm.x + 2, confirm.y + 1))
    await screen.waitFor(() => action === "write_triggers")
    expect(selectedKeys).toEqual(["missing"])
  } finally { await act(async () => screen.renderer.destroy()) }
})
