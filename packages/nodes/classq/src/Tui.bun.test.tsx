/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import { createClassqInteractionSchema } from "./interaction.js"
import { ClassqTui } from "./Tui.js"

test("ClassQ renders routing topology, plan rail and safety execution", async () => {
  const setup = await testRender(<ClassqTui definition={{ schema: createClassqInteractionSchema({ paths: "D:/MediaSet" }, "zh"), run: async () => ({ success: true, message: "计划完成", data: { action: "plan", keyword: "already", waitKeyword: "wait", transferMode: "move", rootCount: 1, keywordCount: 1, readyCount: 1, waitCount: 1, movedCount: 0, copiedCount: 0, conflictCount: 0, errorCount: 0, errors: [], items: [{ rootPath: "D:/MediaSet", parentPath: "D:/MediaSet", keywordPath: "D:/MediaSet/already", sourcePath: "D:/MediaSet/already", targetPath: "D:/MediaSet/wait", sourceName: "already", targetRelative: "wait", kind: "folder", stage: "keyword", status: "found" }, { rootPath: "D:/MediaSet", parentPath: "D:/MediaSet", keywordPath: "D:/MediaSet/already", sourcePath: "D:/MediaSet/pending.zip", targetPath: "D:/MediaSet/wait/pending.zip", sourceName: "pending.zip", targetRelative: "wait/pending.zip", kind: "file", stage: "wait", status: "ready" }] } }) }} language="zh" onExit={() => undefined}/>, { width: 142, height: 38, useMouse: true })
  try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("CLASSQ // ROUTING TOPOLOGY"); expect(frame).toContain("目录路由图"); expect(frame).toContain("分类计划"); expect(frame).toContain("扫描计划") } finally { await act(async () => setup.renderer.destroy()) }
})
