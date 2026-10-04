import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { auditNodeCliSurface, cliSurfaceDrift, extractNodeCliSurface, flagSetShapes } from "./audit-node-cli-surface.ts"

const repoRoot = join(import.meta.dir, "..")

const cittySource = `
import { defineCommand } from "@xiranite/cli-runtime"
const NAME = nodeCliName("sample")
function commonArgs() { return { path: { type: "string" }, json: { type: "boolean" } } }
export function program() {
  return defineCommand({
    meta: { name: NAME, description: "Sample node." },
    subCommands: {
      scan: defineCommand({ meta: { name: "scan", description: "Scan." }, args: commonArgs(), run() {} }),
      apply: defineCommand({ meta: { name: "apply", description: "Apply." }, args: { force: { type: "boolean" } }, run() {} }),
      guided: defineCommand({ meta: { name: "guided", description: "Guided." }, run() {} }),
    },
  })
}
`

test("a citty tree reports the program name, every subcommand and the shared helper's flags", () => {
  const surface = extractNodeCliSurface("sample", "sample/cli.ts", cittySource)
  expect(surface.style).toBe("citty")
  // `meta.name` is `nodeCliName("sample")`; resolving it is what separates xsample from the string "NAME".
  expect(surface.program).toBe("xsample")
  expect(surface.commands.map((command) => command.name)).toEqual(["scan", "apply", "guided"])
  expect(surface.commands[0]?.flags).toEqual(["path", "json"])
  expect(surface.commands[0]?.argsFrom).toBe("helper:commonArgs")
  expect(surface.commands[1]?.flags).toEqual(["force"])
  // A command with no flags is still a command the port must keep reachable.
  expect(surface.commands[2]).toEqual({ name: "guided", description: "Guided.", flags: [], argsFrom: "none" })
})

test("parseArgs and runInteractionCli are recognised as the other two CLI styles", () => {
  const parsed = extractNodeCliSurface("logs", "logs/cli.ts", `
import { parseArgs } from "node:util"
const parsed = parseArgs({ args: rest, options: { tail: { type: "string" }, json: { type: "boolean" } } })
`)
  expect(parsed.style).toBe("parseArgs")
  expect(parsed.commands[0]?.flags).toEqual(["json", "tail"])

  const driven = extractNodeCliSurface("audiov", "audiov/cli.ts", `
import { runInteractionCli } from "@xiranite/cli-runtime/terminal"
export async function runProgram(args, host) { await runInteractionCli({ args, host, createDefinition: (d, l) => ({ schema: createAudiovInteractionSchema(d, l) }) }) }
`)
  expect(driven.style).toBe("interaction-driven")
  expect(driven.commands).toEqual([])

  // Flag strings a hand-rolled parser compares by hand are still inventory material.
  const handRolled = extractNodeCliSurface("bitv", "bitv/cli.ts", `if (args.includes("--json") || args.includes("--no-overwrite")) {}`)
  expect(handRolled.style).toBe("none")
  expect(handRolled.flagLiterals).toEqual(["json", "no-overwrite"])
})

test("a spread of a shared helper inside `… as const` contributes the shared flags", () => {
  const spread = extractNodeCliSurface("marku", "marku/cli.ts", `
function commonArgs() { return { path: { type: "string" }, json: { type: "boolean" } } }
const program = defineCommand({
  meta: { name: "xmarku" },
  subCommands: {
    workflow: defineCommand({
      meta: { name: "workflow", description: "Run a workflow." },
      args: { ...commonArgs(), workflow: { type: "string" } } as const,
      run() {},
    }),
  },
})
`)
  const workflow = spread.commands.find((command) => command.name === "workflow")
  // Reading only the inline pairs would report one flag and hide the two shared ones; declaration order keeps the
  // spread where the author wrote it, which is first here.
  expect(workflow?.flags).toEqual(["path", "json", "workflow"])
  expect(workflow?.argsFrom).toBe("inline")

  const missing = extractNodeCliSurface("other", "other/cli.ts", `
const program = defineCommand({
  meta: { name: "xother" },
  subCommands: { run: defineCommand({ meta: { name: "run" }, args: { ...importedArgs(), one: { type: "string" } } as const, run() {} }) },
})
`)
  const run = missing.commands.find((command) => command.name === "run")
  expect(run?.flags).toEqual(["one"])
  expect(run?.argsFrom).toBe("inline+?unresolved:importedArgs")
})

test("drift is reported in both directions and identical inventories stay silent", () => {
  const baseline = extractNodeCliSurface("sample", "sample/cli.ts", cittySource)
  const narrowed = extractNodeCliSurface("sample", "sample/cli.ts", cittySource.replace('json: { type: "boolean" }', "").replace("guided: defineCommand({ meta: { name: \"guided\", description: \"Guided.\" }, run() {} }),", ""))

  const drift = cliSurfaceDrift([baseline], [narrowed])
  expect(drift.length).toBe(1)
  const entry = drift[0]!
  expect(entry.removed.some((line) => line.includes("command guided"))).toBe(true)
  expect(entry.removed.some((line) => line.includes("scan"))).toBe(true)
  expect(cliSurfaceDrift([baseline], [extractNodeCliSurface("sample", "sample/cli.ts", cittySource)])).toEqual([])
})

test("the inventoried tree accounts for every retained node and splits into the four styles", async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, "docs", "xiranite-target-node-manifest.json"), "utf8")) as {
    nodes: { id: string; disposition: string }[]
  }
  const retained = manifest.nodes.filter((entry) => entry.disposition === "retain-rewrite").map((entry) => entry.id)
  const { surfaces, unreadable } = await auditNodeCliSurface({
    nodesRoot: join(repoRoot, "packages", "nodes"),
    manifestPath: join(repoRoot, "docs", "xiranite-target-node-manifest.json"),
    baselinePath: join(repoRoot, "docs", "node-cli-surface-baseline.json"),
  })
  // No frozen counts: the scan must account for exactly the retained list, naming any node without a CLI file.
  expect([...surfaces.map((surface) => surface.nodeId), ...unreadable].sort()).toEqual([...retained].sort())

  const styles = new Set(surfaces.map((surface) => surface.style))
  expect([...styles].sort()).toEqual(["citty", "interaction-driven", "none", "parseArgs"])

  // The port's real workload: 115 commands share a small number of flag shapes.
  const shapes = flagSetShapes(surfaces)
  expect(shapes.distinct).toBeLessThan(surfaces.reduce((total, surface) => total + surface.commands.length, 0))

  // Cross-check against what the running legacy CLI prints: `USAGE xtrename scan|import|validate|rename|undo|history|guided`.
  const trename = surfaces.find((surface) => surface.nodeId === "trename")!
  expect(trename.program).toBe("xtrename")
  expect(trename.commands.map((command) => command.name).sort()).toEqual(["guided", "history", "import", "rename", "scan", "undo", "validate"])

  // An empty local inventory is only legitimate when the flags live somewhere else that this gate can name:
  // `interaction-driven` nodes take theirs from the node's definition (so the definition must exist), and
  // findz's reason is read from its own source (it prints a GUI-only notice rather than parsing flags).
  const empty = surfaces.filter((surface) => surface.commands.length === 0 && surface.flagLiterals.length === 0)
  expect(empty.every((surface) => surface.style === "interaction-driven" || surface.nodeId === "findz")).toBe(true)
  const drafted = new Set([...(await readdir(join(repoRoot, "node-definitions"))).map((name) => name.replace(/\.json$/, "")), ...(await readdir(join(repoRoot, "plugins")))])
  for (const surface of surfaces.filter((entry) => entry.style === "interaction-driven")) {
    expect(drafted.has(surface.nodeId), `${surface.nodeId} is interaction-driven but publishes no definition`).toBe(true)
  }
  expect(empty.map((surface) => surface.nodeId)).toContain("findz")
  const findzSource = await readFile(join(repoRoot, "packages", "nodes", "findz", "src", "cli.ts"), "utf8")
  // Its own words: the entry point prints a GUI-only notice and parses nothing.
  expect(findzSource).toContain("available from the Xiranite workspace GUI")
})
