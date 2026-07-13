import { describe, expect, test } from "vitest"
import { runClassf } from "./core.js"
import type { ClassfDirEntry, ClassfRuntime } from "./core.js"
import type { CrashuInput } from "@xiranite/node-crashu/core"
import type { MigratefInput } from "@xiranite/node-migratef/core"
import type { SameaInput } from "@xiranite/node-samea/core"

describe("classf pipeline", () => {
  test("orchestrates SameA, CrashU, and MigrateF in pipeline order", async () => {
    const calls: Array<{ stage: string; input: SameaInput | CrashuInput | MigratefInput }> = []
    const runtime = fakeRuntime(calls)
    const result = await runClassf({ action: "plan", classifyMode: "auto" }, runtime)
    expect(result.success).toBe(true)
    expect(calls.map((call) => call.stage)).toEqual(["samea", "crashu", "migratef", "migratef"])
    expect(calls[0]?.input).toEqual(expect.objectContaining({ paths: ["/archives"], action: "plan" }))
    expect(calls[1]?.input).toEqual(expect.objectContaining({ sourcePaths: ["E:\\1Hub\\EH\\1EHV"], targetNames: ["[Artist]"] }))
    expect(calls[2]?.input).toEqual(expect.objectContaining({ sourcePaths: ["/target/[Artist]"], targetPath: "/target/already", mode: "direct" }))
    expect(calls[3]?.input).toEqual(expect.objectContaining({ sourcePaths: ["/target/unmatched"], targetPath: "/target/wait", mode: "direct" }))
    expect(result.data?.items).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "already", sourcePath: "/target/[Artist]" }), expect.objectContaining({ stage: "wait", sourcePath: "/target/unmatched" })]))
  })

  test("fails when the default clipboard has no archive roots", async () => {
    const runtime = fakeRuntime([])
    runtime.readClipboardPaths = async () => []
    const result = await runClassf({ action: "plan" }, runtime)
    expect(result.success).toBe(false)
    expect(result.message).toContain("clipboard")
  })

  test("publishes the complete plan before the first live filesystem stage", async () => {
    const calls: Array<{ stage: string; input: SameaInput | CrashuInput | MigratefInput }> = []
    const timeline: string[] = []
    const runtime = fakeRuntime(calls, (stage, input) => timeline.push(`${stage}:${"action" in input ? input.action : "scan"}`))
    const result = await runClassf({ action: "classify", classifyMode: "auto", dryRun: false }, runtime, (event) => {
      const data = event.data as { kind?: string } | undefined
      if (data?.kind === "classf-plan") timeline.push("event:plan")
    })

    expect(result.success).toBe(true)
    expect(timeline.indexOf("event:plan")).toBeGreaterThan(-1)
    expect(timeline.indexOf("event:plan")).toBeLessThan(timeline.indexOf("samea:classify"))
    expect(calls.map((call) => `${call.stage}:${"action" in call.input ? call.input.action : "scan"}`)).toEqual([
      "samea:plan",
      "crashu:scan",
      "migratef:plan",
      "migratef:plan",
      "samea:classify",
      "migratef:move",
      "migratef:move",
    ])
    expect(result.data?.items.every((item) => item.status === "moved")).toBe(true)
  })
})

function fakeRuntime(calls: Array<{ stage: string; input: SameaInput | CrashuInput | MigratefInput }>, onCall?: (stage: string, input: SameaInput | CrashuInput | MigratefInput) => void): ClassfRuntime {
  return {
    runSamea: async (input) => { calls.push({ stage: "samea", input }); onCall?.("samea", input); return { success: true, message: "samea", data: { action: input.action ?? "plan", centralize: false, minOccurrences: 1, items: [], groups: [{ key: "artist", name: "[Artist]", targetDir: "/target/[Artist]", count: 2, status: "ready" }], scannedCount: 2, detectedCount: 2, readyCount: 2, movedCount: 0, ignoredCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [] } } },
    runCrashu: async (input) => { calls.push({ stage: "crashu", input }); onCall?.("crashu", input); return { success: true, message: "crashu", data: { sourceCount: 1, targetCount: 1, totalScanned: 1, similarFound: 1, movedCount: 0, skippedCount: 0, errorCount: 0, pairsFile: "", similarFolders: [{ name: "Artist Source", path: "/library/Artist Source", target: "[Artist]", similarity: 1, matchDim: "exact", matchSrc: "artist", matchTgt: "artist" }], plan: [], errors: [] } } },
    runMigratef: async (input) => { calls.push({ stage: "migratef", input }); onCall?.("migratef", input); const action = input.action === "copy" ? "copy" : "move"; const status = input.action === "plan" || input.dryRun ? "pending" as const : "success" as const; const plan = (input.sourcePaths ?? []).map((sourcePath) => ({ sourcePath, targetPath: `${input.targetPath}/${sourcePath.split("/").at(-1)}`, action, kind: "directory" as const, status })); return { success: true, message: "migratef", data: { plan, history: [], migratedCount: status === "success" ? plan.length : 0, skippedCount: 0, errorCount: 0, totalCount: plan.length, operationId: "", successCount: status === "success" ? plan.length : 0, failedCount: 0, errors: [] } } },
    readClipboardPaths: async () => ["/archives"],
    pathInfo: async (path) => ({ path, exists: path === "/target" || path === "/target/[Artist]" || path === "/target/unmatched", isFile: false, isDirectory: true }),
    listDir: async (path) => path === "/target" ? [{ name: "[Artist]", path: "/target/[Artist]", isFile: false, isDirectory: true }, { name: "unmatched", path: "/target/unmatched", isFile: false, isDirectory: true }] satisfies ClassfDirEntry[] : [],
    join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"), dirname: (path) => path.replace(/\/[^/]+$/, "") || "/", basename: (path) => path.split("/").at(-1) ?? path, relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
}
