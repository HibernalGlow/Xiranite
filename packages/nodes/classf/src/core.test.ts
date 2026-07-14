import { describe, expect, test } from "vitest"
import { runClassf } from "./core.js"
import type { ClassfDirEntry, ClassfRuntime } from "./core.js"
import type { CrashuInput } from "@xiranite/node-crashu/core"
import type { MigratefInput } from "@xiranite/node-migratef/core"
import type { SameaInput } from "@xiranite/node-samea/core"

describe("classf pipeline", () => {
  test("places every file in already or wait beside its current directory", async () => {
    const calls: Call[] = []
    const result = await runClassf({ action: "plan", classifyMode: "auto", placementMode: "local" }, fakeRuntime(calls))

    expect(result.success).toBe(true)
    expect(result.data?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "/archives/[Artist] A.zip", targetPath: "/archives/already/[Artist] A.zip", stage: "already" }),
      expect.objectContaining({ sourcePath: "/archives/nested/notes.txt", targetPath: "/archives/nested/wait/notes.txt", stage: "wait" }),
    ]))
    expect(calls.filter((call) => call.stage === "migratef").map((call) => call.input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePaths: ["/archives/[Artist] A.zip"], targetPath: "/archives/already", mode: "direct" }),
      expect.objectContaining({ sourcePaths: ["/archives/nested/notes.txt"], targetPath: "/archives/nested/wait", mode: "direct" }),
    ]))
  })

  test("preserves the complete relative path under a selected target root", async () => {
    const result = await runClassf({ action: "plan", classifyMode: "auto", placementMode: "root", targetDir: "/classified" }, fakeRuntime([]))

    expect(result.success).toBe(true)
    expect(result.data?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetPath: "/classified/already/[Artist] A.zip", targetRelative: "already/[Artist] A.zip" }),
      expect.objectContaining({ targetPath: "/classified/wait/nested/notes.txt", targetRelative: "wait/nested/notes.txt" }),
    ]))
  })

  test("keeps each source root name when several roots are sent to one target", async () => {
    const runtime = fakeRuntime([])
    runtime.runSamea = async () => ({ success: true, message: "samea", data: { action: "plan", centralize: false, minOccurrences: 1, items: [], groups: [], scannedCount: 0, detectedCount: 0, readyCount: 0, movedCount: 0, ignoredCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [] } })
    runtime.pathInfo = async (path) => ({ path, exists: true, isFile: path.endsWith(".txt"), isDirectory: !path.endsWith(".txt") })
    runtime.listDir = async (path) => path === "/one" ? [{ name: "sub", path: "/one/sub", isFile: false, isDirectory: true }] : path === "/one/sub" ? [{ name: "same.txt", path: "/one/sub/same.txt", isFile: true, isDirectory: false }] : path === "/two" ? [{ name: "sub", path: "/two/sub", isFile: false, isDirectory: true }] : path === "/two/sub" ? [{ name: "same.txt", path: "/two/sub/same.txt", isFile: true, isDirectory: false }] : []

    const result = await runClassf({ action: "plan", paths: ["/one", "/two"], placementMode: "root", targetDir: "/classified" }, runtime)
    expect(result.data?.items.map((item) => item.targetPath)).toEqual([
      "/classified/wait/one/sub/same.txt",
      "/classified/wait/two/sub/same.txt",
    ])
  })

  test("requires a target directory in root placement mode", async () => {
    const result = await runClassf({ action: "plan", placementMode: "root" }, fakeRuntime([]))
    expect(result.success).toBe(false)
    expect(result.message).toContain("target directory")
  })

  test("does not scan files already inside already or wait", async () => {
    const runtime = fakeRuntime([])
    runtime.listDir = async (path) => path === "/archives" ? [
      { name: "already", path: "/archives/already", isFile: false, isDirectory: true },
      { name: "wait", path: "/archives/wait", isFile: false, isDirectory: true },
      { name: "fresh.txt", path: "/archives/fresh.txt", isFile: true, isDirectory: false },
    ] : []
    runtime.pathInfo = async (path) => ({ path, exists: true, isFile: path.endsWith(".txt"), isDirectory: !path.endsWith(".txt") })
    const result = await runClassf({ action: "plan", placementMode: "local" }, runtime)
    expect(result.data?.items.map((item) => item.sourcePath)).toEqual(["/archives/fresh.txt"])
  })

  test("publishes the complete plan before the first live transfer", async () => {
    const calls: Call[] = []
    const timeline: string[] = []
    const runtime = fakeRuntime(calls, (stage, input) => timeline.push(`${stage}:${"action" in input ? input.action : "scan"}`))
    const result = await runClassf({ action: "classify", classifyMode: "auto", placementMode: "local", dryRun: false }, runtime, (event) => {
      if ((event.data as { kind?: string } | undefined)?.kind === "classf-plan") timeline.push("event:plan")
    })

    expect(result.success).toBe(true)
    expect(timeline.indexOf("event:plan")).toBeLessThan(timeline.indexOf("migratef:move"))
    expect(calls.filter((call) => call.stage === "samea")).toHaveLength(1)
    expect(result.data?.items.every((item) => item.status === "moved")).toBe(true)
  })

  test("runs optional SameA artist grouping after already/wait transfers", async () => {
    const calls: Call[] = []
    const runtime = fakeRuntime(calls)
    const originalPathInfo = runtime.pathInfo
    runtime.pathInfo = async (path) => path.endsWith("/already") || path.endsWith("/wait")
      ? { path, exists: true, isFile: false, isDirectory: true }
      : originalPathInfo(path)
    const result = await runClassf({ action: "classify", classifyMode: "auto", placementMode: "local", dryRun: false, sameaGroupEnabled: true, sameaGroupMinOccurrences: 2 }, runtime)

    expect(result.success).toBe(true)
    const sameaCalls = calls.filter((call) => call.stage === "samea").map((call) => call.input as SameaInput)
    expect(sameaCalls).toHaveLength(3)
    expect(sameaCalls.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "classify", paths: ["/archives/already"], minOccurrences: 2, dryRun: false }),
      expect.objectContaining({ action: "classify", paths: ["/archives/nested/wait"], minOccurrences: 2, dryRun: false }),
    ]))
  })

  test("groups pre-existing already/wait directories without reclassifying their contents", async () => {
    const calls: Call[] = []
    const runtime = fakeRuntime(calls)
    runtime.pathInfo = async (path) => ({ path, exists: ["/archives", "/archives/already", "/archives/wait", "/archives/already/[Artist]"].includes(path), isFile: false, isDirectory: ["/archives", "/archives/already", "/archives/wait", "/archives/already/[Artist]"].includes(path) })
    runtime.listDir = async (path) => path === "/archives" ? [
      { name: "already", path: "/archives/already", isFile: false, isDirectory: true },
      { name: "wait", path: "/archives/wait", isFile: false, isDirectory: true },
    ] : path === "/archives/already" ? [
      { name: "[Artist]", path: "/archives/already/[Artist]", isFile: false, isDirectory: true },
    ] : []

    const result = await runClassf({ action: "classify", paths: ["/archives"], placementMode: "local", dryRun: false, sameaGroupEnabled: true }, runtime)

    expect(result.success).toBe(true)
    expect(calls.filter((call) => call.stage === "migratef")).toHaveLength(0)
    const postCalls = calls.filter((call) => call.stage === "samea").slice(1).map((call) => call.input as SameaInput)
    expect(postCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ paths: ["/archives/already"], action: "classify", skipGroupedDirectories: true }),
      expect.objectContaining({ paths: ["/archives/wait"], action: "classify", skipGroupedDirectories: true }),
    ]))
  })

  test("fails when the default clipboard has no archive roots", async () => {
    const runtime = fakeRuntime([])
    runtime.readClipboardPaths = async () => []
    const result = await runClassf({ action: "plan" }, runtime)
    expect(result.success).toBe(false)
    expect(result.message).toContain("clipboard")
  })
})

type Call = { stage: string; input: SameaInput | CrashuInput | MigratefInput }

function fakeRuntime(calls: Call[], onCall?: (stage: string, input: SameaInput | CrashuInput | MigratefInput) => void): ClassfRuntime {
  const directories = new Set(["/archives", "/archives/nested"])
  const files = new Set(["/archives/[Artist] A.zip", "/archives/nested/notes.txt"])
  return {
    runSamea: async (input) => { calls.push({ stage: "samea", input }); onCall?.("samea", input); return { success: true, message: "samea", data: { action: input.action ?? "plan", centralize: false, minOccurrences: 1, items: [{ rootPath: "/archives", sourcePath: "/archives/[Artist] A.zip", targetPath: "/archives/[Artist]/[Artist] A.zip", sourceName: "[Artist] A.zip", artistKey: "artist", artistName: "[Artist]", status: "ready" }], groups: [{ key: "artist", name: "[Artist]", targetDir: "/archives/[Artist]", count: 1, status: "ready" }], scannedCount: 1, detectedCount: 1, readyCount: 1, movedCount: 0, ignoredCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [] } } },
    runCrashu: async (input) => { calls.push({ stage: "crashu", input }); onCall?.("crashu", input); return { success: true, message: "crashu", data: { sourceCount: 1, targetCount: 1, totalScanned: 1, similarFound: 1, movedCount: 0, skippedCount: 0, errorCount: 0, pairsFile: "", similarFolders: [{ name: "Artist", path: "/library/Artist", target: "[Artist]", similarity: 1, matchDim: "exact", matchSrc: "artist", matchTgt: "artist" }], plan: [], errors: [] } } },
    runMigratef: async (input) => { calls.push({ stage: "migratef", input }); onCall?.("migratef", input); const action = input.action === "copy" ? "copy" : "move"; const status = input.action === "plan" || input.dryRun ? "pending" as const : "success" as const; const plan = (input.sourcePaths ?? []).map((sourcePath) => ({ sourcePath, targetPath: `${input.targetPath}/${sourcePath.split("/").at(-1)}`, action, kind: "file" as const, status })); return { success: true, message: "migratef", data: { plan, history: [], migratedCount: status === "success" ? plan.length : 0, skippedCount: 0, errorCount: 0, totalCount: plan.length, operationId: "", successCount: status === "success" ? plan.length : 0, failedCount: 0, errors: [] } } },
    readClipboardPaths: async () => ["/archives"],
    pathInfo: async (path) => ({ path, exists: directories.has(path) || files.has(path), isFile: files.has(path), isDirectory: directories.has(path) }),
    listDir: async (path) => path === "/archives" ? [{ name: "[Artist] A.zip", path: "/archives/[Artist] A.zip", isFile: true, isDirectory: false }, { name: "nested", path: "/archives/nested", isFile: false, isDirectory: true }] satisfies ClassfDirEntry[] : path === "/archives/nested" ? [{ name: "notes.txt", path: "/archives/nested/notes.txt", isFile: true, isDirectory: false }] : [],
    join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"), dirname: (path) => path.replace(/\/[^/]+$/, "") || "/", basename: (path) => path.split("/").at(-1) ?? path, relative: (from, to) => to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
  }
}
