import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { auditPluginManifests, CANONICAL_HOST_FUNCTIONS } from "./audit-plugin-manifests.ts"

let root = ""

const writeManifest = async (pluginId: string, manifest: Record<string, unknown>): Promise<void> => {
  const dir = join(root, pluginId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

const clean = {
  id: "gizmo",
  wasm: "gizmo.wasm",
  memoryMaxPages: 64,
  allowedPaths: [],
  allowedHosts: [],
  pluginVersion: "0.1.0",
  pluginApiVersion: "1.0",
  runtimeVersion: "1.0.0",
  hostFunctions: ["xiranite.operation.checkpoint", "xiranite.operation.emit", "xiranite.fs.read"],
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "xiranite-plugin-manifests-"))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("host-function vocabulary single source", () => {
  test("the Rust Plugin API constants and the gate list are the same set", async () => {
    const { readFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const source = await readFile(
      join(import.meta.dir, "..", "crates", "xiranite-plugin-api", "src", "host_function_names.rs"),
      "utf8",
    )
    const declared = [...source.matchAll(/^pub const HOST_FUNCTION_[A-Z_]+: &str = "([^"]+)";$/gm)].map((match) => match[1]!)
      // HOST_FUNCTION_NAMESPACE is the prefix constant, not a capability name.
      .filter((name) => name.startsWith("xiranite."))
    // Non-vacuous: the module declares one constant per capability, so an empty capture means the regex
    // stopped matching and this test would silently pass.
    expect(declared.length).toBeGreaterThan(10)
    expect(new Set(declared).size).toBe(declared.length)
    for (const name of declared) {
      expect(CANONICAL_HOST_FUNCTIONS).toContain(name)
    }
    for (const name of CANONICAL_HOST_FUNCTIONS) {
      expect(declared).toContain(name)
    }
    expect(declared.length).toBe(CANONICAL_HOST_FUNCTIONS.length)
  })
})

describe("plugin manifest gate", () => {
  test("accepts a capability-named manifest that declares all three versions", async () => {
    await writeManifest("gizmo", clean)
    const reports = await auditPluginManifests({ pluginsRoot: root })
    expect(reports.map((report) => report.pluginId)).toEqual(["gizmo"])
    expect(reports[0]?.problems).toEqual([])
  })

  test("reports a superseded host function with its replacement", async () => {
    await writeManifest("legacyfn", { ...clean, id: "legacyfn", hostFunctions: ["xiranite.checkpoint", "xiranite.file.list_dir"] })
    const reports = await auditPluginManifests({ pluginsRoot: root })
    const problems = reports.find((report) => report.pluginId === "legacyfn")?.problems ?? []
    expect(problems).toContain('host function "xiranite.checkpoint" is superseded by the capability name "xiranite.operation.checkpoint"')
    expect(problems).toContain('host function "xiranite.file.list_dir" is superseded by the capability name "xiranite.fs.list"')
  })

  test("reports an invented host function that has no capability mapping", async () => {
    await writeManifest("invented", { ...clean, id: "invented", hostFunctions: ["xiranite.operation.checkpoint", "xiranite.do_anything"] })
    const reports = await auditPluginManifests({ pluginsRoot: root })
    expect(reports.find((report) => report.pluginId === "invented")?.problems)
      .toContain('host function "xiranite.do_anything" is not in the ADR-0068 capability vocabulary')
  })

  test("refuses a versionless manifest and a mismatched id", async () => {
    const withoutVersions = { ...clean, id: "noversion" }
    delete (withoutVersions as Partial<typeof clean>).pluginVersion
    delete (withoutVersions as Partial<typeof clean>).pluginApiVersion
    await writeManifest("noversion", withoutVersions)
    await writeManifest("wrongid", { ...clean, id: "other" })

    const reports = await auditPluginManifests({ pluginsRoot: root })
    const versionProblems = reports.find((report) => report.pluginId === "noversion")?.problems ?? []
    expect(versionProblems.some((problem) => problem.includes("missing pluginVersion"))).toBe(true)
    expect(versionProblems.some((problem) => problem.includes("missing pluginApiVersion"))).toBe(true)
    expect(reports.find((report) => report.pluginId === "wrongid")?.problems)
      .toContain('id must equal the plugin directory name "wrongid"')
  })

  test("rejects a non-numeric version so pluginApiVersion cannot become a free-form string", async () => {
    await writeManifest("badversion", { ...clean, id: "badversion", pluginApiVersion: "next" })
    const reports = await auditPluginManifests({ pluginsRoot: root })
    expect(reports.find((report) => report.pluginId === "badversion")?.problems)
      .toContain('pluginApiVersion = "next" is not a dotted numeric version')
  })
})
